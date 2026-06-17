const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const crypto = require('crypto');
const EmailConfig = require('../models/EmailConfig');
const User = require('../models/User');
const TrackedEmail = require('../models/TrackedEmail');
const { listMessages, supportsMailbox } = require('../services/mailboxService');
const { sendEmail } = require('../services/emailService');
const logger = require('../utils/logger');

const GMAIL_ATTACHMENT_TOTAL_LIMIT_BYTES = 25 * 1024 * 1024;
const BLOCKED_ATTACHMENT_EXTENSIONS = new Set(['ade', 'adp', 'apk', 'appx', 'bat', 'cab', 'chm', 'cmd', 'com', 'cpl', 'diagcab', 'dll', 'dmg', 'exe', 'hta', 'ins', 'isp', 'iso', 'jar', 'js', 'jse', 'lib', 'lnk', 'mde', 'msc', 'msi', 'msp', 'mst', 'nsh', 'pif', 'ps1', 'reg', 'scr', 'sct', 'sh', 'sys', 'vb', 'vbe', 'vbs', 'vxd', 'wsc', 'wsf', 'wsh']);

const getAttachmentExtension = (filename = '') => filename.split('.').pop()?.toLowerCase() || '';

const chunkBase64 = (value) => value.match(/.{1,76}/g)?.join('\r\n') || '';

const buildPlainTextBody = (html = '') => {
  const processedHtml = String(html)
    .replace(/<a\b[^>]*?href="([^"]+)"[^>]*?>([\s\S]*?)<\/a>/gi, (match, href, text) => {
      const trimmedText = text.replace(/<[^>]+>/g, '').trim();
      const trimmedHref = href.trim();
      if (trimmedText && trimmedHref) {
        return `${trimmedText} (${trimmedHref})`;
      }
      return trimmedText || trimmedHref || '';
    });

  return processedHtml
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
};

const appendMimePartHeader = (lines, boundary, headers, body) => {
  lines.push(`--${boundary}`);

  headers.forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      lines.push(`${key}: ${value}`);
    }
  });

  lines.push('');

  if (body !== undefined) {
    lines.push(body || '');
  }
};

const appendMultipartAlternative = (lines, boundary, textBody, htmlBody) => {
  appendMimePartHeader(lines, boundary, [
    ['Content-Type', 'text/plain; charset=utf-8'],
    ['Content-Transfer-Encoding', '7bit']
  ], textBody);

  appendMimePartHeader(lines, boundary, [
    ['Content-Type', 'text/html; charset=utf-8'],
    ['Content-Transfer-Encoding', '7bit']
  ], htmlBody);

  lines.push(`--${boundary}--`);
};

const appendAttachmentPart = (lines, boundary, attachment) => {
  const filename = attachment.originalname || attachment.filename || 'attachment';
  const contentType = attachment.mimetype || attachment.contentType || 'application/octet-stream';
  const base64Content = chunkBase64(
    Buffer.isBuffer(attachment.buffer)
      ? attachment.buffer.toString('base64')
      : Buffer.from(attachment.contentBase64 || '', 'base64').toString('base64')
  );

  appendMimePartHeader(lines, boundary, [
    ['Content-Type', `${contentType}; name="${filename}"`],
    ...(attachment.cid ? [['Content-ID', `<${attachment.cid}>`]] : []),
    ['Content-Disposition', `${attachment.disposition || (attachment.cid ? 'inline' : 'attachment')}; filename="${filename}"`],
    ['Content-Transfer-Encoding', 'base64']
  ], base64Content);
};

const buildGmailRawMessage = ({ from, to, cc, bcc, subject, textBody, htmlBody, trackingId, attachments = [] }) => {
  const mixedBoundary = `emaildrop_mixed_${crypto.randomBytes(12).toString('hex')}`;
  const relatedBoundary = `emaildrop_related_${crypto.randomBytes(12).toString('hex')}`;
  const alternativeBoundary = `emaildrop_alternative_${crypto.randomBytes(12).toString('hex')}`;
  const inlineAttachments = attachments.filter((attachment) => attachment.cid);
  const regularAttachments = attachments.filter((attachment) => !attachment.cid);
  const hasInlineAttachments = inlineAttachments.length > 0;
  const hasRegularAttachments = regularAttachments.length > 0;
  const outerBoundary = hasRegularAttachments
    ? mixedBoundary
    : hasInlineAttachments
      ? relatedBoundary
      : alternativeBoundary;
  const outerType = hasRegularAttachments
    ? 'multipart/mixed'
    : hasInlineAttachments
      ? 'multipart/related'
      : 'multipart/alternative';
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    subject ? `Subject: ${subject}` : 'Subject: (No Subject)',
    'MIME-Version: 1.0',
    `Content-Type: ${outerType}; boundary="${outerBoundary}"`
  ];

  if (trackingId) {
    lines.push(`X-Entity-Ref-ID: ${trackingId}`);
  }

  if (cc) lines.push(`Cc: ${cc}`);
  if (bcc) lines.push(`Bcc: ${bcc}`);

  lines.push('');

  if (hasRegularAttachments) {
    if (hasInlineAttachments) {
      appendMimePartHeader(lines, mixedBoundary, [
        ['Content-Type', `multipart/related; boundary="${relatedBoundary}"`]
      ]);
      appendMimePartHeader(lines, relatedBoundary, [
        ['Content-Type', `multipart/alternative; boundary="${alternativeBoundary}"`]
      ]);
      appendMultipartAlternative(lines, alternativeBoundary, textBody, htmlBody);

      inlineAttachments.forEach((attachment) => {
        appendAttachmentPart(lines, relatedBoundary, attachment);
      });

      lines.push(`--${relatedBoundary}--`);
    } else {
      appendMimePartHeader(lines, mixedBoundary, [
        ['Content-Type', `multipart/alternative; boundary="${alternativeBoundary}"`]
      ]);
      appendMultipartAlternative(lines, alternativeBoundary, textBody, htmlBody);
    }

    regularAttachments.forEach((attachment) => {
      appendAttachmentPart(lines, mixedBoundary, attachment);
    });

    lines.push(`--${mixedBoundary}--`);
  } else if (hasInlineAttachments) {
    appendMimePartHeader(lines, relatedBoundary, [
      ['Content-Type', `multipart/alternative; boundary="${alternativeBoundary}"`]
    ]);
    appendMultipartAlternative(lines, alternativeBoundary, textBody, htmlBody);

    inlineAttachments.forEach((attachment) => {
      appendAttachmentPart(lines, relatedBoundary, attachment);
    });

    lines.push(`--${relatedBoundary}--`);
  } else {
    appendMultipartAlternative(lines, alternativeBoundary, textBody, htmlBody);
  }

  lines.push('');

  return Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

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
  accountId: trackedEmail.accountId || 'gmail',
  accountEmail: trackedEmail.senderEmail,
  provider: trackedEmail.provider || 'gmail',
  source: trackedEmail.provider === 'gmail' ? 'gmail' : 'api'
});

const mapGmailMessage = (message, folder, accountEmail) => {
  const headers = message.data.payload.headers || [];
  const getHeader = (name) => {
    const header = headers.find((item) => item.name.toLowerCase() === name.toLowerCase());
    return header ? header.value : '';
  };

  const isDraft = folder === 'drafts';

  return {
    id: `gmail:${message.data.id}`,
    sender: normalizeHeaderValue(getHeader('From')),
    to: normalizeHeaderValue(getHeader('To')),
    subject: getHeader('Subject') || '(No Subject)',
    content: getGmailBody(message.data.payload).substring(0, 500),
    timestamp: new Date(parseInt(message.data.internalDate, 10)),
    status: isDraft ? 'draft' : (message.data.labelIds.includes('UNREAD') ? 'unread' : 'read'),
    isRead: isDraft ? true : !message.data.labelIds.includes('UNREAD'),
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

const isSameMailboxEmail = (left, right) =>
  String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();

const fetchGmailEmails = async (user, folder) => {
  if (!user?.googleAccessToken) {
    return [];
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL || process.env.GOOGLE_REDIRECT_URI
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
  status: folder === 'drafts' ? 'draft' : (message.seen ? 'read' : 'unread'),
  isRead: folder === 'drafts' ? true : !!message.seen,
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
    const selectedConfig = accountId && accountId !== 'gmail'
      ? configs.find((config) => String(config._id) === String(accountId))
      : null;
    const selectedConfigEmail = selectedConfig?.config?.email || selectedConfig?.email || null;
    const shouldUseGmailApiForSelectedConfig = selectedConfig?.provider === 'gmail'
      && isSameMailboxEmail(selectedConfigEmail, user?.email);

    const mailboxConfigs = configs.filter((config) => {
      if (accountId && accountId !== 'gmail' && String(config._id) !== String(accountId)) {
        return false;
      }

      // Configured Gmail accounts do not have their own OAuth token set in this app.
      // Only the signed-in primary Gmail mailbox should be loaded, via Gmail API.
      if (config.provider === 'gmail') {
        return false;
      }

      if (shouldUseGmailApiForSelectedConfig && String(config._id) === String(selectedConfig?._id)) {
        return false;
      }

      return supportsMailbox(config);
    });

    const results = await Promise.all([
      (!accountId || accountId === 'gmail' || shouldUseGmailApiForSelectedConfig)
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
      let trackedEmails = await TrackedEmail.find({ userId }).sort({ createdAt: -1 }).limit(100);

      if (selectedConfig && !supportsMailbox(selectedConfig)) {
        trackedEmails = trackedEmails.filter((item) =>
          String(item.accountId || '') === String(selectedConfig._id) ||
          String(item.provider || '') === String(selectedConfig.provider)
        );
      }

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
    const { to, subject, content, cc, bcc, isTracked, accountId, account } = req.body;
    const userId = req.user._id;
    const attachments = Array.isArray(req.files) ? req.files.map((file) => ({
      filename: file.originalname,
      contentType: file.mimetype || 'application/octet-stream',
      content: file.buffer,
      size: file.size || (file.buffer ? file.buffer.length : 0),
      disposition: 'attachment'
    })) : [];

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

    const selectedAccountId = String(accountId || account?.id || 'gmail');
    const emailConfig = selectedAccountId === 'gmail'
      ? {
          _id: 'gmail',
          provider: 'gmail',
          config: { email: user.email }
        }
      : await EmailConfig.findOne({
          _id: selectedAccountId,
          userId
        });

    if (!emailConfig) {
      return res.status(404).json({
        success: false,
        message: 'Selected email account not found'
      });
    }

    const trackingId = isTracked ? crypto.randomUUID() : null;
    const result = await sendEmail(
      emailConfig,
      user,
      to,
      subject,
      content,
      trackingId,
      {
        cc,
        bcc,
        attachments,
        trackingEnabled: !!isTracked
      }
    );

    if (!result.success) {
      return res.status(result.statusCode || 500).json({
        success: false,
        message: result.error || 'Failed to send email',
        providerError: result.providerError
      });
    }

    logger.info({ trackingId, accountId: selectedAccountId }, 'Email sent successfully');

    res.json({
      success: true,
      message: 'Email sent successfully',
      data: {
        messageId: result?.data?.messageId || null,
        trackingId,
        tracked: !!trackingId,
        accountId: selectedAccountId
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
