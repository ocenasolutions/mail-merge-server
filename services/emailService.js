const nodemailer = require('nodemailer');
const axios = require('axios');
const { google } = require('googleapis');
const logger = require('../utils/logger');
const { appendSentMessage, supportsMailbox } = require('./mailboxService');
const { appendEmailDebugLog, redactApiKey } = require('../utils/emailDebugLogger');
const SignatureAsset = require('../models/SignatureAsset');
const TrackedEmail = require('../models/TrackedEmail');
const providerRegistry = require('./providers');

const BLOCKED_ATTACHMENT_EXTENSIONS = new Set(['ade', 'adp', 'apk', 'appx', 'bat', 'cab', 'chm', 'cmd', 'com', 'cpl', 'diagcab', 'dll', 'dmg', 'exe', 'hta', 'ins', 'isp', 'iso', 'jar', 'js', 'jse', 'lib', 'lnk', 'mde', 'msc', 'msi', 'msp', 'mst', 'nsh', 'pif', 'ps1', 'reg', 'scr', 'sct', 'sh', 'sys', 'vb', 'vbe', 'vbs', 'vxd', 'wsc', 'wsf', 'wsh']);
const PROVIDER_ATTACHMENT_LIMITS = {
  gmail: 25 * 1024 * 1024,
  outlook: 25 * 1024 * 1024,
  hostinger: 25 * 1024 * 1024,
  smtp: 25 * 1024 * 1024,
  brevo: 20 * 1024 * 1024,
  sendgrid: 30 * 1024 * 1024,
  mailgun: 25 * 1024 * 1024,
  godaddy: 30 * 1024 * 1024,
  titan: 25 * 1024 * 1024
};

const getAttachmentExtension = (filename = '') => filename.split('.').pop()?.toLowerCase() || '';
const chunkBase64 = (value) => value.match(/.{1,76}/g)?.join('\r\n') || '';
const isValidEmail = (value = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());

const getAxiosResponseData = (error) => error?.response?.data || null;

const formatProviderError = (error) => {
  const responseData = getAxiosResponseData(error);

  if (!responseData) {
    return error.message;
  }

  if (typeof responseData === 'string') {
    return responseData;
  }

  return responseData.message || responseData.error || JSON.stringify(responseData);
};

const normalizeAttachments = (attachments = []) => attachments.map((attachment) => ({
  filename: attachment.filename || attachment.name,
  contentType: attachment.contentType || attachment.mimeType || 'application/octet-stream',
  content: Buffer.isBuffer(attachment.content)
    ? attachment.content
    : Buffer.from(attachment.contentBase64 || '', 'base64'),
  size: attachment.size || (attachment.content ? attachment.content.length : Buffer.from(attachment.contentBase64 || '', 'base64').length)
}));

const validateAttachments = (provider, attachments = []) => {
  const normalizedAttachments = normalizeAttachments(attachments);
  const blockedAttachment = normalizedAttachments.find((attachment) => BLOCKED_ATTACHMENT_EXTENSIONS.has(getAttachmentExtension(attachment.filename)));

  if (blockedAttachment) {
    throw new Error(`Attachment type not allowed: ${blockedAttachment.filename}`);
  }

  const providerLimit = PROVIDER_ATTACHMENT_LIMITS[provider] || PROVIDER_ATTACHMENT_LIMITS.smtp;
  const totalAttachmentBytes = normalizedAttachments.reduce((sum, attachment) => sum + (attachment.size || 0), 0);

  if (totalAttachmentBytes > providerLimit) {
    throw new Error(`Attachments exceed the ${Math.round(providerLimit / (1024 * 1024))} MB limit for ${provider}.`);
  }

  return normalizedAttachments;
};

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
  const disposition = attachment.disposition || (attachment.cid ? 'inline' : 'attachment');

  appendMimePartHeader(lines, boundary, [
    ['Content-Type', `${attachment.contentType}; name="${attachment.filename}"`],
    ...(attachment.cid ? [['Content-ID', `<${attachment.cid}>`]] : []),
    ['Content-Disposition', `${disposition}; filename="${attachment.filename}"`],
    ['Content-Transfer-Encoding', 'base64']
  ], chunkBase64(attachment.content.toString('base64')));
};

const buildGmailRawMessage = ({ from, to, subject, textBody, htmlBody, trackingId, cc, bcc, attachments = [] }) => {
  const mixedBoundary = `emaildrop_mixed_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const relatedBoundary = `emaildrop_related_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const alternativeBoundary = `emaildrop_alternative_${Date.now()}_${Math.random().toString(16).slice(2)}`;
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
    `Subject: ${subject}`,
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

const mergeTags = (text, data) => {
  if (!text) return text;

  const mergeData = data instanceof Map ? Object.fromEntries(data) : (data || {});
  const normalizedData = Object.entries(mergeData).reduce((acc, [key, value]) => {
    acc[key] = value;
    acc[key.toLowerCase()] = value;
    acc[key.replace(/[\s_]+/g, '').toLowerCase()] = value;
    return acc;
  }, {});

  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, rawKey) => {
    const key = rawKey.trim();
    const normalizedKey = key.replace(/[\s_]+/g, '').toLowerCase();
    const exact = mergeData[key];
    const lower = normalizedData[key.toLowerCase()];
    const normalized = normalizedData[normalizedKey];
    const resolved = exact ?? lower ?? normalized;
    return resolved !== undefined && resolved !== null && resolved !== '' ? resolved : match;
  });
};

const hasHtml = (value) => /<\/?[a-z][\s\S]*>/i.test(value);
const hasBlockHtml = (value) => /<(p|div|ul|ol|li|table|thead|tbody|tr|td|th|h[1-6]|blockquote|br)\b/i.test(value);

const escapeHtml = (value) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const decodeHtmlEntities = (value) => value
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, '\'')
  .replace(/&amp;/gi, '&');

const autoLinkTextUrls = (html) => {
  if (!html) return html;
  const parts = html.split(/(<\/?[a-zA-Z0-9]+(?:\s+[^>]*?)?>)/g);
  let inAnchor = false;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith('<')) {
      const tagNameMatch = part.match(/^<\/?([a-zA-Z0-9]+)/);
      if (tagNameMatch) {
        const tagName = tagNameMatch[1].toLowerCase();
        if (tagName === 'a') {
          inAnchor = !part.startsWith('</');
        }
      }
    } else if (!inAnchor) {
      const urlRegex = /(https?:\/\/[^\s"'<>\(\)]+)/gi;
      parts[i] = part.replace(urlRegex, (url) => {
        return `<a href="${url}" style="color: #dc2626; text-decoration: underline;">${url}</a>`;
      });
    }
  }

  return parts.join('');
};

const normalizeEmailBody = (body) => {
  if (!body) return body;
  const decodedBody = decodeHtmlEntities(body);

  let html;
  if (hasHtml(decodedBody) && hasBlockHtml(decodedBody)) {
    html = decodedBody;
  } else if (hasHtml(decodedBody)) {
    html = decodedBody
      .split(/\r?\n\r?\n+/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => `<p>${paragraph.replace(/\r?\n/g, '<br>')}</p>`)
      .join('');
  } else {
    html = escapeHtml(decodedBody)
      .split(/\r?\n\r?\n+/)
      .map((paragraph) => `<p>${paragraph.replace(/\r?\n/g, '<br>')}</p>`)
      .join('');
  }

  return autoLinkTextUrls(html);
};

const stripHtmlForPreview = (value = '') => String(value)
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<br\s*\/?>(?=)/gi, '\n')
  .replace(/<\/p>/gi, '\n')
  .replace(/<\/div>/gi, '\n')
  .replace(/<\/li>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/\s+/g, ' ')
  .trim();

const buildSentEmailContent = (html = '') => stripHtmlForPreview(html).slice(0, 1000);

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

const buildSignatureImageUrlPattern = () => {
  const appUrl = process.env.APP_URL ? String(process.env.APP_URL).replace(/\/$/, '') : null;
  const escapedAppUrl = appUrl?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefix = escapedAppUrl
    ? `(?:${escapedAppUrl})?\\/api\\/auth\\/signature-images\\/`
    : `(?:https?:\\/\\/[^"'\\s<>]+)?\\/api\\/auth\\/signature-images\\/`;

  return new RegExp(`(<img\\b[^>]*?src=["'])${prefix}([a-f0-9]{24})(["'][^>]*>)`, 'gi');
};

const getEmailPublicAppUrl = () => (
  process.env.EMAIL_PUBLIC_APP_URL ||
  process.env.PUBLIC_APP_URL ||
  process.env.APP_URL ||
  ''
).replace(/\/$/, '');

const rewriteSignatureImageUrls = (html) => {
  const publicAppUrl = getEmailPublicAppUrl();
  if (!html || !publicAppUrl) return html;

  const pattern = buildSignatureImageUrlPattern();
  return html.replace(pattern, (match, before, assetId, after) => (
    `${before}${publicAppUrl}/api/auth/signature-images/${assetId}${after}`
  ));
};

const inlineSignatureImages = async (html, existingAttachments = [], options = {}) => {
  if (!html) {
    return { html, attachments: existingAttachments };
  }

  if (options.embedImages === false) {
    return {
      html: rewriteSignatureImageUrls(html),
      attachments: existingAttachments
    };
  }

  const signatureAssetIds = [];
  const pattern = buildSignatureImageUrlPattern();

  html.replace(pattern, (match, before, assetId) => {
    if (!signatureAssetIds.includes(assetId)) {
      signatureAssetIds.push(assetId);
    }
    return match;
  });

  if (signatureAssetIds.length === 0) {
    return { html, attachments: existingAttachments };
  }

  const assets = await SignatureAsset.find({ _id: { $in: signatureAssetIds } }).lean();
  const assetsById = new Map(assets.map((asset) => [String(asset._id), asset]));
  const inlineAttachments = [];

  const normalizeAssetBuffer = (data) => {
    if (Buffer.isBuffer(data)) return data;
    if (data?.buffer && Buffer.isBuffer(data.buffer)) return data.buffer;
    if (Array.isArray(data?.data)) return Buffer.from(data.data);
    if (Array.isArray(data)) return Buffer.from(data);
    return Buffer.alloc(0);
  };

  const nextHtml = html.replace(pattern, (match, before, assetId, after) => {
    const asset = assetsById.get(assetId);
    if (!asset?.data) {
      return match;
    }

    const content = normalizeAssetBuffer(asset.data);
    if (!content.length) {
      return match;
    }

    const cid = `signature-${assetId}@emaildrop`;
    inlineAttachments.push({
      filename: asset.filename || `signature-${assetId}`,
      contentType: asset.mimeType || 'image/png',
      content,
      size: asset.size || content.length,
      cid,
      disposition: 'inline'
    });

    return `${before}cid:${cid}${after}`;
  });

  return {
    html: nextHtml,
    attachments: [...existingAttachments, ...inlineAttachments]
  };
};

const createTransporter = async (emailConfig, user) => {
  switch (emailConfig.provider) {
    case 'gmail':
      // For Gmail, we'll use Gmail API directly instead of SMTP
      // This works better with the gmail.send OAuth scope
      return null; // We'll handle Gmail differently in sendEmail function

    case 'godaddy':
    case 'hostinger':
    case 'smtp':
    case 'outlook':
    case 'titan':
      logger.info({
        provider: emailConfig.provider,
        host: emailConfig.config.host,
        port: emailConfig.config.port,
        secure: emailConfig.config.secure !== false,
        username: emailConfig.config.username
      }, '🔧 Creating SMTP transporter');

      return nodemailer.createTransport({
        host: emailConfig.config.host,
        port: emailConfig.config.port,
        secure: emailConfig.config.secure !== false,
        auth: {
          user: emailConfig.config.username,
          pass: emailConfig.config.password
        },
        connectionTimeout: 60000, // 60 seconds
        greetingTimeout: 30000,
        socketTimeout: 60000,
        logger: false, // Disable nodemailer's internal logging
        debug: false
      });

    default:
      throw new Error('Unsupported email provider');
  }
};

const sendEmail = async (emailConfig, user, recipient, subject, body, trackingId, options = {}) => {
  try {
    const trackingEnabled = options.trackingEnabled !== false;
    const attachments = validateAttachments(emailConfig.provider, options.attachments || []);
    logger.info({ 
      recipient, 
      trackingId,
      trackingEnabled,
      attachmentCount: attachments.length,
      provider: emailConfig.provider,
      hasEmailConfig: !!emailConfig,
      hasUser: !!user,
      hasSubject: !!subject,
      hasBody: !!body
    }, '📧 Starting email send');

    // Validate inputs
    if (!emailConfig) {
      throw new Error('Email configuration is missing');
    }
    if (!user) {
      throw new Error('User is missing');
    }
    if (!recipient) {
      throw new Error('Recipient email is missing');
    }
    if (!subject) {
      throw new Error('Email subject is missing');
    }
    if (!body) {
      throw new Error('Email body is missing');
    }

    const normalizedBody = normalizeEmailBody(body);
    const inlinedSignature = await inlineSignatureImages(normalizedBody, attachments, {
      embedImages: true
    });
    const emailAttachments = inlinedSignature.attachments;
    let providerMessageId = null;
    const shouldStoreLocalSentEmail = !supportsMailbox(emailConfig);
    const activeTrackingId = trackingEnabled ? trackingId : null;
    const plainTextBody = buildPlainTextBody(inlinedSignature.html);

    // Add tracking pixel with multiple fallback methods
    const trackingUrl = activeTrackingId ? `${process.env.APP_URL}/track/${activeTrackingId}` : null;
    
    // Method 1: Standard img tag
    const trackingPixel = trackingUrl ? `<img src="${trackingUrl}" width="1" height="1" alt="" style="display:block;border:0;outline:none;" />` : '';
    
    // Method 2: Background image in a div (some email clients load this)
    const trackingDiv = trackingUrl ? `<div style="background-image:url('${trackingUrl}');width:1px;height:1px;"></div>` : '';
    
    // Method 3: CSS background (another fallback)
    const trackingStyle = trackingUrl ? `<table cellpadding="0" cellspacing="0" border="0" style="width:1px;height:1px;"><tr><td style="background:url('${trackingUrl}') no-repeat;width:1px;height:1px;"></td></tr></table>` : '';
    
    // Add all tracking methods + optional view in browser link
    const trackingMarkup = trackingEnabled
      ? trackingPixel + trackingDiv + trackingStyle
      : '';
    const bodyWithTracking = rewriteTrackedLinks(inlinedSignature.html + trackingMarkup, activeTrackingId, trackingEnabled);
    
    logger.info({ 
      recipient, 
      trackingUrl,
      trackingEnabled,
      provider: emailConfig.provider,
      emailConfigEmail: emailConfig.config?.email,
      userEmail: user.email
    }, '📧 Sending email payload');

    const sendResult = await providerRegistry.send({
      emailConfig,
      user,
      recipient,
      subject,
      htmlBody: bodyWithTracking,
      textBody: plainTextBody,
      trackingId: activeTrackingId,
      cc: options.cc,
      bcc: options.bcc,
      attachments: emailAttachments
    });

    providerMessageId = sendResult.providerMessageId || sendResult.messageId || null;

    if (shouldStoreLocalSentEmail) {
      try {
        if (activeTrackingId) {
          await TrackedEmail.findOneAndUpdate(
            { trackingId: activeTrackingId },
            {
              $set: {
                userId: user._id,
                trackingId: activeTrackingId,
                providerMessageId,
                provider: emailConfig.provider,
                accountId: String(emailConfig._id || ''),
                senderEmail: emailConfig.config?.email || user.email,
                recipientEmail: recipient,
                cc: options.cc,
                bcc: options.bcc,
                subject: subject || '(No Subject)',
                content: buildSentEmailContent(bodyWithTracking),
                trackingEnabled,
                openCount: 0,
                clickCount: 0,
                firstOpenedAt: null,
                lastOpenedAt: null,
                clicks: []
              }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        }
      } catch (persistError) {
        logger.warn({ err: persistError, recipient, provider: emailConfig.provider }, 'Could not store local sent email');
      }
    }

    logger.info({ recipient, provider: emailConfig.provider }, '✅ Email sent successfully');
    return { success: true };
  } catch (error) {
    appendEmailDebugLog('email_send_error', {
      provider: emailConfig?.provider,
      recipient,
      senderEmail: emailConfig?.config?.email || user?.email || null,
      subject,
      errorMessage: error.message,
      providerStatus: error.response?.status,
      providerError: getAxiosResponseData(error),
      apiKeyPreview: redactApiKey(emailConfig?.config?.apiKey)
    });

    logger.error({ 
      err: error, 
      recipient,
      errorMessage: error.message,
      errorResponse: error.response?.data,
      errorStatus: error.response?.status,
      provider: emailConfig?.provider
    }, '❌ Email send error');
    return {
      success: false,
      error: formatProviderError(error),
      providerError: getAxiosResponseData(error),
      statusCode: error.response?.status
    };
  }
};

const testEmailConnection = async (emailConfig, user) => {
  try {
    switch (emailConfig.provider) {
      case 'gmail':
        // Check if we have refresh token
        if (!user.googleRefreshToken) {
          return { 
            success: false, 
            message: 'Google authentication expired. Please log out and log in again to reconnect Gmail.' 
          };
        }

        // Test using Gmail API - just check if we can refresh the token
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_CALLBACK_URL
        );

        oauth2Client.setCredentials({
          access_token: user.googleAccessToken,
          refresh_token: user.googleRefreshToken
        });

        // Try to refresh token - this validates the OAuth setup
        try {
          await oauth2Client.refreshAccessToken();
          return { success: true, message: 'Gmail OAuth connection successful. Ready to send emails.' };
        } catch (error) {
          return { 
            success: false, 
            message: 'Failed to refresh Gmail token. Please log out and log in again.' 
          };
        }

      case 'godaddy':
      case 'hostinger':
      case 'smtp':
      case 'titan':
        const smtpTransporter = await createTransporter(emailConfig, user);
        await smtpTransporter.verify();
        return {
          success: true,
          message:
            emailConfig.provider === 'godaddy'
              ? 'GoDaddy SMTP connection successful'
              : emailConfig.provider === 'hostinger'
                ? 'Hostinger SMTP connection successful'
                : emailConfig.provider === 'outlook'
                  ? 'Outlook / Microsoft 365 SMTP connection successful'
                  : emailConfig.provider === 'titan'
                    ? 'Titan SMTP connection successful'
                    : 'SMTP connection successful'
        };

      case 'sendgrid':
        await axios.get('https://api.sendgrid.com/v3/user/profile', {
          headers: {
            Authorization: `Bearer ${emailConfig.config.apiKey}`
          }
        });
        return { success: true, message: 'SendGrid API key valid' };

      case 'mailgun':
        await axios.get(
          `https://api.mailgun.net/v3/domains/${emailConfig.config.domain}`,
          {
            auth: {
              username: 'api',
              password: emailConfig.config.apiKey
            }
          }
        );
        return { success: true, message: 'Mailgun credentials valid' };

      case 'brevo':
        await axios.get('https://api.brevo.com/v3/account', {
          headers: {
            'api-key': emailConfig.config.apiKey
          }
        });
        return { success: true, message: 'Brevo API key valid' };

      default:
        return { success: false, message: 'Unsupported provider' };
    }
  } catch (error) {
    logger.error({ err: error, provider }, 'Test connection error');
    return { success: false, message: error.message || 'Connection test failed' };
  }
};

module.exports = {
  mergeTags,
  sendEmail,
  testEmailConnection,
  createTransporter
};
