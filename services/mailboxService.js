const { ImapFlow } = require('imapflow');
const { google } = require('googleapis');
const { simpleParser } = require('mailparser');
const logger = require('../utils/logger');
const User = require('../models/User');

const MAILBOX_PROVIDERS = new Set(['gmail', 'godaddy', 'hostinger', 'smtp']);

const supportsMailbox = (emailConfig) => MAILBOX_PROVIDERS.has(emailConfig?.provider);

const refreshGmailAccessToken = async (user) => {
  if (!user.googleRefreshToken) {
    throw new Error('Google authentication expired. Please reconnect Gmail.');
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
  );

  oauth2Client.setCredentials({
    access_token: user.googleAccessToken,
    refresh_token: user.googleRefreshToken
  });

  const { credentials } = await oauth2Client.refreshAccessToken();
  const accessToken = credentials.access_token || user.googleAccessToken;

  if (credentials.access_token && credentials.access_token !== user.googleAccessToken) {
    await User.findByIdAndUpdate(user._id, { googleAccessToken: credentials.access_token });
  }

  return accessToken;
};

const getMailboxDefaults = (provider) => {
  switch (provider) {
    case 'gmail':
      return { host: 'imap.gmail.com', port: 993, secure: true, inboxPath: 'INBOX' };
    case 'godaddy':
      return { host: 'imap.secureserver.net', port: 993, secure: true, inboxPath: 'INBOX' };
    case 'hostinger':
      return { host: 'imap.hostinger.com', port: 993, secure: true, inboxPath: 'INBOX' };
    default:
      return { host: '', port: 993, secure: true, inboxPath: 'INBOX' };
  }
};

const createMailboxClient = async (emailConfig, user) => {
  if (!supportsMailbox(emailConfig)) {
    throw new Error(`Mailbox sync is not supported for ${emailConfig.provider}`);
  }

  const defaults = getMailboxDefaults(emailConfig.provider);
  const mailboxEmail = emailConfig.config.email || user.email;
  let auth;

  if (emailConfig.provider === 'gmail') {
    const accessToken = await refreshGmailAccessToken(user);
    auth = {
      user: mailboxEmail,
      accessToken
    };
  } else {
    const username = emailConfig.config.imapUsername || emailConfig.config.username || mailboxEmail;
    const password = emailConfig.config.imapPassword || emailConfig.config.password;

    if (!username || !password) {
      throw new Error('IMAP username/password missing for this mailbox configuration');
    }

    auth = {
      user: username,
      pass: password
    };
  }

  const host = emailConfig.config.imapHost || defaults.host;
  const port = emailConfig.config.imapPort || defaults.port;
  const secure = typeof emailConfig.config.imapSecure === 'boolean'
    ? emailConfig.config.imapSecure
    : defaults.secure;

  if (!host || !port) {
    throw new Error('IMAP host/port missing for this mailbox configuration');
  }

  const client = new ImapFlow({
    host,
    port,
    secure,
    auth,
    logger: false
  });

  await client.connect();
  return client;
};

const findMailboxPath = (mailboxes, kind, preferredPath) => {
  if (preferredPath) {
    const exact = mailboxes.find((mailbox) => mailbox.path === preferredPath);
    if (exact) return exact.path;
  }

  if (kind === 'inbox') {
    const inbox = mailboxes.find((mailbox) => mailbox.path.toUpperCase() === 'INBOX');
    return inbox?.path || 'INBOX';
  }

  if (kind === 'sent') {
    const specialUseSent = mailboxes.find((mailbox) => mailbox.specialUse === '\\Sent');
    if (specialUseSent) return specialUseSent.path;

    const byName = mailboxes.find((mailbox) => /sent/i.test(mailbox.path) || /sent/i.test(mailbox.name || ''));
    if (byName) return byName.path;
  }

  return mailboxes[0]?.path || 'INBOX';
};

const mapAddresses = (addresses = []) =>
  addresses
    .map((item) => ({
      name: item.name || '',
      address: item.address || ''
    }))
    .filter((item) => item.address);

const listMailboxes = async (emailConfig, user) => {
  const client = await createMailboxClient(emailConfig, user);

  try {
    const mailboxes = await client.list();
    return mailboxes.map((mailbox) => ({
      path: mailbox.path,
      name: mailbox.name,
      specialUse: mailbox.specialUse || null
    }));
  } finally {
    await client.logout().catch(() => {});
  }
};

const resolveMailboxPath = async (client, emailConfig, folder) => {
  const mailboxes = await client.list();
  const preferredPath = folder === 'sent' ? emailConfig.config.sentPath : emailConfig.config.inboxPath;
  return findMailboxPath(mailboxes, folder, preferredPath);
};

const listMessages = async (emailConfig, user, { folder = 'inbox', limit = 10, offset = 0 } = {}) => {
  const client = await createMailboxClient(emailConfig, user);

  try {
    const mailboxPath = await resolveMailboxPath(client, emailConfig, folder);

    const lock = await client.getMailboxLock(mailboxPath);
    try {
      const total = client.mailbox.exists || 0;
      if (!total) {
        return {
          mailbox: { path: mailboxPath, total, limit, offset, hasMore: false },
          messages: []
        };
      }

      const end = Math.max(1, total - offset);
      const start = Math.max(1, end - limit + 1);
      const messages = [];

      for await (const message of client.fetch(`${start}:${end}`, {
        uid: true,
        flags: true,
        envelope: true,
        internalDate: true
      })) {
        messages.push({
          uid: message.uid,
          subject: message.envelope?.subject || '(no subject)',
          date: message.internalDate || message.envelope?.date || null,
          from: mapAddresses(message.envelope?.from),
          to: mapAddresses(message.envelope?.to),
          seen: message.flags?.has('\\Seen') || false,
          answered: message.flags?.has('\\Answered') || false,
          flagged: message.flags?.has('\\Flagged') || false
        });
      }

      messages.reverse();

      return {
        mailbox: {
          path: mailboxPath,
          total,
          limit,
          offset,
          hasMore: start > 1
        },
        messages
      };
    } finally {
      lock.release();
    }
  } catch (error) {
    logger.error({ err: error, provider: emailConfig.provider }, 'Mailbox fetch failed');
    throw error;
  } finally {
    await client.logout().catch(() => {});
  }
};

const getMessageDetail = async (emailConfig, user, { folder = 'inbox', uid }) => {
  const client = await createMailboxClient(emailConfig, user);

  try {
    const mailboxPath = await resolveMailboxPath(client, emailConfig, folder);
    const lock = await client.getMailboxLock(mailboxPath);
    try {
      const message = await client.fetchOne(String(uid), {
        uid: true,
        flags: true,
        envelope: true,
        internalDate: true,
        source: true
      }, { uid: true });

      if (!message || !message.source) {
        throw new Error('Message not found');
      }

      const parsed = await simpleParser(message.source);
      return {
        uid: message.uid,
        subject: parsed.subject || message.envelope?.subject || '(no subject)',
        date: parsed.date || message.internalDate || message.envelope?.date || null,
        from: mapAddresses(message.envelope?.from),
        to: mapAddresses(message.envelope?.to),
        seen: message.flags?.has('\\Seen') || false,
        answered: message.flags?.has('\\Answered') || false,
        flagged: message.flags?.has('\\Flagged') || false,
        html: parsed.html || '',
        text: parsed.textAsHtml || parsed.text || ''
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
};

const appendSentMessage = async (emailConfig, user, { to, subject, html, from, date = new Date() }) => {
  const client = await createMailboxClient(emailConfig, user);

  try {
    const mailboxPath = await resolveMailboxPath(client, emailConfig, 'sent');
    const mimeMessage = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      `Date: ${new Date(date).toUTCString()}`,
      '',
      html
    ].join('\r\n');

    await client.append(mailboxPath, mimeMessage, ['\\Seen'], date);
    return { success: true, mailboxPath };
  } finally {
    await client.logout().catch(() => {});
  }
};

module.exports = {
  supportsMailbox,
  listMailboxes,
  listMessages,
  getMessageDetail,
  appendSentMessage
};
