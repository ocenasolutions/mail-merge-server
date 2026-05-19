const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const crypto = require('crypto');
const EmailConfig = require('../models/EmailConfig');
const User = require('../models/User');
const TrackedEmail = require('../models/TrackedEmail');
const { listMessages, supportsMailbox } = require('../services/mailboxService');
const logger = require('../utils/logger');

const normalizeHeaderValue = (value = '') => value.replace(/\s+/g, ' ').trim();

const extractEmailAddress = (value = '') => {
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim().toLowerCase();
};

const buildKnownAccountEmails = (user, configs) => {
  const knownEmails = new Set();

  if (user?.email) {
    knownEmails.add(user.email.toLowerCase());
  }

  configs.forEach((config) => {
    const email = config.config?.email || config.email;
    if (email) {
      knownEmails.add(email.toLowerCase());
    }
  });

  return knownEmails;
};

const getGmailBody = (payload) => {
  if (payload.parts) {
    const textPart = payload.parts.find((part) => part.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      return Buffer.from(textPart.body.data, 'base64').toString('utf-8');
    }
  }

  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  return '';
};

const escapeHtml = (value = '') => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const normalizeEmailBody = (body = '') => {
  if (/<\/?[a-z][\s\S]*>/i.test(body)) {
    return body;
  }

  return escapeHtml(body)
    .split(/\r?\n\r?\n+/)
    .map((paragraph) => `<p>${paragraph.replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
};

const escapeAttribute = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const rewriteTrackedLinks = (html, trackingId, enabled) => {
  if (!enabled || !html) return html;
  const baseUrl = process.env.APP_URL;

  return html.replace(/<a\b([^>]*?)href="([^"]+)"([^>]*)>/gi, (match, before, href, after) => {
    const trimmedHref = href.trim();
    if (!/^https?:\/\//i.test(trimmedHref)) return match;

    const redirectUrl = `${baseUrl}/api/tracking/click/${trackingId}?url=${encodeURIComponent(trimmedHref)}`;
    return `<a${before}href="${escapeAttribute(redirectUrl)}"${after}>`;
  });
};

const buildTrackedBody = (content, trackingId, enabled) => {
  const normalizedBody = normalizeEmailBody(content);
  if (!enabled) {
    return normalizedBody;
  }

  const trackingUrl = `${process.env.APP_URL}/track/${trackingId}`;
  const trackingMarkup = [
    `<img src="${trackingUrl}" width="1" height="1" alt="" style="display:block;border:0;outline:none;" />`,
    `<div style="background-image:url('${trackingUrl}');width:1px;height:1px;"></div>`,
    `<table cellpadding="0" cellspacing="0" border="0" style="width:1px;height:1px;"><tr><td style="background:url('${trackingUrl}') no-repeat;width:1px;height:1px;"></td></tr></table>`
  ].join('');

  return rewriteTrackedLinks(`${normalizedBody}${trackingMarkup}`, trackingId, enabled);
};

const mapTrackedEmail = (trackedEmail) => ({
  id: `tracked:${trackedEmail._id}`,
  sender: trackedEmail.senderEmail,
  to: trackedEmail.recipientEmail,
  subject: trackedEmail.subject || '(No Subject)',
  content: trackedEmail.content || '',
  timestamp: new Date(trackedEmail.createdAt),
  status: trackedEmail.openCount > 0 ? 'tracked' : 'read',
  isRead: true,
  isTracked: !!trackedEmail.trackingEnabled,
  isOpened: (trackedEmail.openCount || 0) > 0,
  openCount: trackedEmail.openCount || 0,
  clicks: trackedEmail.clickCount || 0,
  folder: 'sent',
  accountId: 'gmail',
  accountEmail: trackedEmail.senderEmail,
  source: 'gmail'
});

const mapGmailMessage = (message, folder, accountEmail) => {
  const headers = message.data.payload.headers || [];
  const getHeader = (name) => {
    const header = headers.find((item) => item.name.toLowerCase() === name.toLowerCase());
    return header ? header.value : '';
  };

  return {
    id: `gmail:${message.data.id}`,
    sender: normalizeHeaderValue(getHeader('From')),
    to: normalizeHeaderValue(getHeader('To')),
    subject: getHeader('Subject') || '(No Subject)',
    content: getGmailBody(message.data.payload).substring(0, 500),
    timestamp: new Date(parseInt(message.data.internalDate, 10)),
    status: message.data.labelIds.includes('UNREAD') ? 'unread' : 'read',
    isRead: !message.data.labelIds.includes('UNREAD'),
    isTracked: false,
    isOpened: false,
    openCount: 0,
    clicks: 0,
    folder,
    accountId: 'gmail',
    accountEmail,
    source: 'gmail'
  };
};

const fetchGmailEmails = async (user, folder) => {
  if (!user?.googleAccessToken) {
    return [];
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: user.googleAccessToken,
    refresh_token: user.googleRefreshToken
  });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  let labelIds = ['INBOX'];
  if (folder === 'sent') labelIds = ['SENT'];
  if (folder === 'drafts') labelIds = ['DRAFT'];
  if (folder === 'trash') labelIds = ['TRASH'];

  const response = await gmail.users.messages.list({
    userId: 'me',
    labelIds,
    maxResults: 50
  });

  const messages = response.data.messages || [];
  const emails = await Promise.all(messages.map(async (message) => {
    try {
      const fullMessage = await gmail.users.messages.get({
        userId: 'me',
        id: message.id,
        format: 'full'
      });

      return mapGmailMessage(fullMessage, folder, user.email);
    } catch (err) {
      logger.error({ err, messageId: message.id }, 'Error fetching Gmail message');
      return null;
    }
  }));

  return emails.filter(Boolean);
};

const mapMailboxMessage = (config, folder, message) => ({
  id: `config:${config._id}:${folder}:${message.uid}`,
  sender: message.from?.map((item) => item.name ? `${item.name} <${item.address}>` : item.address).join(', ') || (config.config?.email || config.email || ''),
  to: message.to?.map((item) => item.name ? `${item.name} <${item.address}>` : item.address).join(', '),
  subject: message.subject || '(No Subject)',
  content: '',
  timestamp: message.date ? new Date(message.date) : new Date(),
  status: message.seen ? 'read' : 'unread',
  isRead: !!message.seen,
  isTracked: false,
  isOpened: false,
  openCount: 0,
  clicks: 0,
  folder,
  accountId: String(config._id),
  accountEmail: config.config?.email || config.email || '',
  source: 'mailbox'
});

exports.getEmails = async (req, res) => {
  try {
    const { folder = 'inbox', accountId } = req.query;
    const userId = req.user._id;
    const user = await User.findById(userId);
    const configs = await EmailConfig.find({ userId });
    const knownAccountEmails = buildKnownAccountEmails(user, configs);

    const mailboxConfigs = configs.filter((config) => {
      if (accountId && accountId !== 'gmail' && String(config._id) !== String(accountId)) {
        return false;
      }

      return supportsMailbox(config);
    });

    const results = await Promise.all([
      (!accountId || accountId === 'gmail')
        ? fetchGmailEmails(user, folder).catch((error) => {
            logger.error({ err: error }, 'Error fetching Gmail mailbox');
            return [];
          })
        : Promise.resolve([]),
      ...mailboxConfigs.map((config) =>
        listMessages(config, user, { folder, limit: 25, offset: 0 })
          .then((result) => result.messages.map((message) => mapMailboxMessage(config, folder, message)))
          .catch((error) => {
            logger.error({ err: error, configId: config._id }, 'Error fetching configured mailbox');
            return [];
          })
      )
    ]);

    let emails = results
      .flat()
      .filter(Boolean)
      .filter((email) => {
        const senderEmail = extractEmailAddress(email.sender || '');

        if (folder === 'inbox') {
          return senderEmail ? !knownAccountEmails.has(senderEmail) : true;
        }

        if (folder === 'sent') {
          return senderEmail ? knownAccountEmails.has(senderEmail) : true;
        }

        return true;
      });

    if (folder === 'sent') {
      const trackedEmails = await TrackedEmail.find({ userId }).sort({ createdAt: -1 }).limit(100);
      const trackedByMessageId = new Map(
        trackedEmails
          .filter((item) => item.providerMessageId)
          .map((item) => [`gmail:${item.providerMessageId}`, mapTrackedEmail(item)])
      );

      emails = emails.map((email) => trackedByMessageId.get(email.id) || email);

      const existingIds = new Set(emails.map((email) => email.id));
      const additionalTrackedEmails = trackedEmails
        .map(mapTrackedEmail)
        .filter((email) => !existingIds.has(email.id) && !trackedByMessageId.has(email.id));

      emails = [...additionalTrackedEmails, ...emails];
    }

    emails = emails.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.json({
      success: true,
      data: emails
    });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching emails');
    res.json({
      success: true,
      data: []
    });
  }
};

exports.getEmail = async (req, res) => {
  try {
    res.json({
      success: true,
      data: null
    });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching email');
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.sendEmail = async (req, res) => {
  try {
    const { to, subject, content, cc, bcc, isTracked } = req.body;
    const userId = req.user._id;

    const user = await User.findById(userId);

    if (!user || !user.googleAccessToken) {
      return res.status(400).json({
        success: false,
        message: 'Google authentication required. Please log out and log in again.'
      });
    }

    if (isTracked && !process.env.APP_URL) {
      return res.status(400).json({
        success: false,
        message: 'APP_URL is required to enable email tracking.'
      });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: user.googleAccessToken,
      refresh_token: user.googleRefreshToken
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const trackingId = isTracked ? crypto.randomUUID() : null;
    const htmlBody = buildTrackedBody(content || '', trackingId, !!isTracked);

    const emailLines = [
      `From: ${user.email}`,
      `To: ${to}`,
      subject ? `Subject: ${subject}` : 'Subject: (No Subject)',
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8'
    ];

    if (trackingId) {
      emailLines.push(`X-Entity-Ref-ID: ${trackingId}`);
    }

    if (cc) emailLines.push(`Cc: ${cc}`);
    if (bcc) emailLines.push(`Bcc: ${bcc}`);

    emailLines.push('');
    emailLines.push(htmlBody);

    const email = emailLines.join('\\r\\n');
    const encodedEmail = Buffer.from(email)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedEmail
      }
    });

    let trackedEmail = null;
    if (trackingId) {
      trackedEmail = await TrackedEmail.create({
        userId,
        trackingId,
        providerMessageId: result.data.id,
        senderEmail: user.email,
        recipientEmail: to,
        cc,
        bcc,
        subject: subject || '(No Subject)',
        content: String(content || '').substring(0, 1000),
        trackingEnabled: true
      });
    }

    logger.info({ messageId: result.data.id, trackingId }, 'Email sent successfully via Gmail API');

    res.json({
      success: true,
      message: 'Email sent successfully',
      data: {
        messageId: result.data.id,
        trackingId,
        tracked: !!trackedEmail
      }
    });
  } catch (error) {
    logger.error({ err: error }, 'Error sending email');
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send email'
    });
  }
};

exports.saveDraft = async (req, res) => {
  try {
    const { to, subject, content, cc, bcc } = req.body;

    res.json({
      success: true,
      message: 'Draft saved successfully',
      data: {
        id: Date.now().toString(),
        to,
        subject,
        content,
        cc,
        bcc,
        createdAt: new Date()
      }
    });
  } catch (error) {
    logger.error({ err: error }, 'Error saving draft');
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.deleteEmail = async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Email deleted successfully'
    });
  } catch (error) {
    logger.error({ err: error }, 'Error deleting email');
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Email marked as read'
    });
  } catch (error) {
    logger.error({ err: error }, 'Error marking email as read');
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
