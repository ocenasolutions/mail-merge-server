const { ImapFlow } = require('imapflow');
const { google } = require('googleapis');
const { simpleParser } = require('mailparser');
const logger = require('../utils/logger');
const User = require('../models/User');

const authFailureCount = new Map(); // email -> count
const AUTH_FAILURE_THRESHOLD = 3;
const activeConnections = new Set();

const MAILBOX_PROVIDERS = new Set(['gmail', 'godaddy', 'hostinger', 'smtp', 'outlook', 'titan']);

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
      return { host: 'imap.gmail.com', port: 993, secure: true, inboxPath: 'INBOX', sentPath: '[Gmail]/Sent Mail', draftsPath: '[Gmail]/Drafts', trashPath: '[Gmail]/Trash' };
    case 'godaddy':
      return { host: 'imap.secureserver.net', port: 993, secure: true, inboxPath: 'INBOX', sentPath: 'Sent', draftsPath: 'Drafts', trashPath: 'Trash' };
    case 'outlook':
      return { host: 'outlook.office365.com', port: 993, secure: true, inboxPath: 'INBOX', sentPath: 'Sent Items', draftsPath: 'Drafts', trashPath: 'Deleted Items' };
    case 'hostinger':
      return { host: 'imap.hostinger.com', port: 993, secure: true, inboxPath: 'INBOX', sentPath: 'Sent', draftsPath: 'Drafts', trashPath: 'Trash' };
    case 'titan':
      return { host: 'imap.titan.email', port: 993, secure: true, inboxPath: 'INBOX', sentPath: 'Sent', draftsPath: 'Drafts', trashPath: 'Trash' };
    default:
      return { host: '', port: 993, secure: true, inboxPath: 'INBOX', sentPath: 'Sent', draftsPath: 'Drafts', trashPath: 'Trash' };
  }
};

const attachMailboxErrorHandler = (client, emailConfig) => {
  client.on('error', (error) => {
    logger.error(
      {
        err: error,
        provider: emailConfig?.provider,
        email: emailConfig?.config?.email || emailConfig?.email || null
      },
      'IMAP client error'
    );
  });
};

const closeMailboxClient = async (client) => {
  if (!client) return;

  try {
    if (client.usable) {
      await client.logout();
      return;
    }
  } catch (error) {
    logger.warn({ err: error }, 'IMAP logout failed, closing socket');
  }

  try {
    client.close();
  } catch (error) {
    logger.warn({ err: error }, 'IMAP close failed');
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
    tls: { rejectUnauthorized: false },
    socketTimeout: 10000,    // fail fast instead of waiting 20s
    connectionTimeout: 8000, // fail fast instead of waiting 15s
    logger: false
  });

  attachMailboxErrorHandler(client, emailConfig);

  const accountKey = mailboxEmail.toLowerCase();
  if ((authFailureCount.get(accountKey) || 0) >= AUTH_FAILURE_THRESHOLD) {
    logger.warn({ email: accountKey }, `Skipping connection to ${accountKey} — repeated auth failures`);
    throw new Error(`Skipping ${accountKey} — repeated auth failures`);
  }

  try {
    await client.connect();
    activeConnections.add(client);
    client.on('close', () => {
      activeConnections.delete(client);
    });
    authFailureCount.delete(accountKey); // reset on success
  } catch (err) {
    if (err.authenticationFailed || (err.message && err.message.includes('AUTHENTICATIONFAILED'))) {
      const nextCount = (authFailureCount.get(accountKey) || 0) + 1;
      authFailureCount.set(accountKey, nextCount);
      if (nextCount >= AUTH_FAILURE_THRESHOLD) {
        setTimeout(() => authFailureCount.delete(accountKey), 60 * 60 * 1000).unref();
      }
    }
    throw err;
  }
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
    await closeMailboxClient(client);
  }
};

const resolveMailboxPath = async (client, emailConfig, folder) => {
  const mailboxes = await client.list();
  const defaults = getMailboxDefaults(emailConfig.provider);
  const preferredPathMap = {
    inbox: emailConfig.config.inboxPath || defaults.inboxPath,
    sent: emailConfig.config.sentPath || defaults.sentPath,
    drafts: emailConfig.config.draftsPath || defaults.draftsPath,
    trash: emailConfig.config.trashPath || defaults.trashPath
  };
  const preferredPath = preferredPathMap[folder] || preferredPathMap.inbox;
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
    await closeMailboxClient(client);
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
        text: parsed.text || parsed.textAsHtml || ''
      };
    } finally {
      lock.release();
    }
  } finally {
    await closeMailboxClient(client);
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
    await closeMailboxClient(client);
  }
};

module.exports = {
  supportsMailbox,
  listMailboxes,
  listMessages,
  getMessageDetail,
  appendSentMessage,
  getActiveConnectionsCount: () => activeConnections.size
};
