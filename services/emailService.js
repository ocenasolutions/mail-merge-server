const nodemailer = require('nodemailer');
const axios = require('axios');
const { google } = require('googleapis');
const logger = require('../utils/logger');
const { appendSentMessage } = require('./mailboxService');

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

const normalizeEmailBody = (body) => {
  if (!body) return body;
  const decodedBody = decodeHtmlEntities(body);

  if (hasHtml(decodedBody) && hasBlockHtml(decodedBody)) {
    return decodedBody;
  }

  if (hasHtml(decodedBody)) {
    return decodedBody
      .split(/\r?\n\r?\n+/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => `<p>${paragraph.replace(/\r?\n/g, '<br>')}</p>`)
      .join('');
  }

  return escapeHtml(decodedBody)
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

const createTransporter = async (emailConfig, user) => {
  switch (emailConfig.provider) {
    case 'gmail':
      // For Gmail, we'll use Gmail API directly instead of SMTP
      // This works better with the gmail.send OAuth scope
      return null; // We'll handle Gmail differently in sendEmail function

    case 'godaddy':
    case 'hostinger':
    case 'smtp':
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
        secure: emailConfig.config.secure !== false, // Default to true for GoDaddy
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
    logger.info({ 
      recipient, 
      trackingId,
      trackingEnabled,
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

    // Add tracking pixel with multiple fallback methods
    const trackingUrl = `${process.env.APP_URL}/track/${trackingId}`;
    
    // Method 1: Standard img tag
    const trackingPixel = `<img src="${trackingUrl}" width="1" height="1" alt="" style="display:block;border:0;outline:none;" />`;
    
    // Method 2: Background image in a div (some email clients load this)
    const trackingDiv = `<div style="background-image:url('${trackingUrl}');width:1px;height:1px;"></div>`;
    
    // Method 3: CSS background (another fallback)
    const trackingStyle = `<table cellpadding="0" cellspacing="0" border="0" style="width:1px;height:1px;"><tr><td style="background:url('${trackingUrl}') no-repeat;width:1px;height:1px;"></td></tr></table>`;
    
    // Add all tracking methods + optional view in browser link
    const trackingMarkup = trackingEnabled
      ? trackingPixel + trackingDiv + trackingStyle
      : '';
    const bodyWithTracking = rewriteTrackedLinks(normalizedBody + trackingMarkup, trackingId, trackingEnabled);
    
    logger.info({ 
      recipient, 
      trackingUrl,
      provider: emailConfig.provider,
      emailConfigEmail: emailConfig.config?.email,
      userEmail: user.email
    }, '📧 Sending email with tracking pixel');

    switch (emailConfig.provider) {
      case 'gmail':
        logger.info({ recipient }, '📤 Sending via Gmail API');
        
        // Check if we have refresh token
        if (!user.googleRefreshToken) {
          throw new Error('Google authentication expired. Please log out and log in again to reconnect Gmail.');
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

        // Refresh token if needed
        try {
          const { credentials } = await oauth2Client.refreshAccessToken();
          if (credentials.access_token && credentials.access_token !== user.googleAccessToken) {
            const User = require('../models/User');
            await User.findByIdAndUpdate(user._id, { googleAccessToken: credentials.access_token });
            logger.info({ userId: user._id }, '🔄 Updated user access token');
          }
        } catch (error) {
          logger.error({ err: error }, '❌ Failed to refresh token');
        }

        // Create Gmail API client
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // Create email message
        const fromEmail = emailConfig.config.email || user.email;
        const emailLines = [
          `From: ${fromEmail}`,
          `To: ${recipient}`,
          `Subject: ${subject}`,
          'MIME-Version: 1.0',
          'Content-Type: text/html; charset=utf-8',
          '',
          bodyWithTracking
        ];

        const email = emailLines.join('\r\n');
        const encodedEmail = Buffer.from(email)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        // Send via Gmail API
        await gmail.users.messages.send({
          userId: 'me',
          requestBody: {
            raw: encodedEmail
          }
        });

        logger.info({ recipient }, '✅ Email sent successfully via Gmail API');
        break;

      case 'godaddy':
      case 'hostinger':
      case 'smtp':
        logger.info({ 
          provider: emailConfig.provider,
          recipient,
          host: emailConfig.config?.host,
          port: emailConfig.config?.port
        }, '🔧 Creating transporter');

        const transporter = await createTransporter(emailConfig, user);
        
        logger.info({ recipient }, '📤 Sending via transporter');

        const mailOptions = {
          from: emailConfig.config.email || user.email,
          to: recipient,
          subject,
          html: bodyWithTracking,
          headers: {
            'X-Entity-Ref-ID': trackingId,
            'List-Unsubscribe': `<${process.env.APP_URL}/unsubscribe/${trackingId}>`,
          }
        };

        logger.info({ 
          from: mailOptions.from,
          to: mailOptions.to,
          subject: mailOptions.subject
        }, '📧 Mail options prepared');

        await transporter.sendMail(mailOptions);

        try {
          await appendSentMessage(emailConfig, user, {
            to: recipient,
            subject,
            html: bodyWithTracking,
            from: mailOptions.from,
            date: new Date()
          });
        } catch (appendError) {
          logger.warn({ err: appendError, provider: emailConfig.provider, recipient }, 'Could not append sent message to IMAP Sent folder');
        }
        
        logger.info({ recipient }, '✅ Email sent successfully via transporter');
        break;

      case 'sendgrid':
        logger.info({ recipient }, '📤 Sending via SendGrid');
        await axios.post(
          'https://api.sendgrid.com/v3/mail/send',
          {
            personalizations: [{ to: [{ email: recipient }] }],
            from: { email: emailConfig.config.email },
            subject,
            content: [{ type: 'text/html', value: bodyWithTracking }]
          },
          {
            headers: {
              Authorization: `Bearer ${emailConfig.config.apiKey}`,
              'Content-Type': 'application/json'
            }
          }
        );
        logger.info({ recipient }, '✅ Email sent successfully via SendGrid');
        break;

      case 'mailgun':
        logger.info({ recipient }, '📤 Sending via Mailgun');
        const formData = new URLSearchParams();
        formData.append('from', emailConfig.config.email);
        formData.append('to', recipient);
        formData.append('subject', subject);
        formData.append('html', bodyWithTracking);

        await axios.post(
          `https://api.mailgun.net/v3/${emailConfig.config.domain}/messages`,
          formData,
          {
            auth: {
              username: 'api',
              password: emailConfig.config.apiKey
            }
          }
        );
        logger.info({ recipient }, '✅ Email sent successfully via Mailgun');
        break;

      case 'brevo':
        logger.info({ recipient }, '📤 Sending via Brevo');
        const fromName = emailConfig.config.fromName || emailConfig.config.email.split('@')[0];
        await axios.post(
          'https://api.brevo.com/v3/smtp/email',
          {
            sender: { 
              email: emailConfig.config.email,
              name: fromName
            },
            to: [{ email: recipient }],
            subject,
            htmlContent: bodyWithTracking
          },
          {
            headers: {
              'api-key': emailConfig.config.apiKey,
              'Content-Type': 'application/json'
            }
          }
        );
        logger.info({ recipient }, '✅ Email sent successfully via Brevo');
        break;

      default:
        throw new Error('Unsupported email provider');
    }

    logger.info({ recipient, provider: emailConfig.provider }, '✅ Email sent successfully');
    return { success: true };
  } catch (error) {
    logger.error({ 
      err: error, 
      recipient,
      errorMessage: error.message,
      errorResponse: error.response?.data,
      errorStatus: error.response?.status,
      provider: emailConfig?.provider
    }, '❌ Email send error');
    return { success: false, error: error.message };
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
        const smtpTransporter = await createTransporter(emailConfig, user);
        await smtpTransporter.verify();
        return {
          success: true,
          message:
            emailConfig.provider === 'godaddy'
              ? 'GoDaddy SMTP connection successful'
              : emailConfig.provider === 'hostinger'
                ? 'Hostinger SMTP connection successful'
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
    console.error('Test connection error:', error);
    return { success: false, message: error.message || 'Connection test failed' };
  }
};

module.exports = {
  mergeTags,
  sendEmail,
  testEmailConnection,
  createTransporter
};
