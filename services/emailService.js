const nodemailer = require('nodemailer');
const axios = require('axios');
const { google } = require('googleapis');
const logger = require('../utils/logger');

const mergeTags = (text, data) => {
  if (!text) return text;
  
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return data[key] || match;
  });
};

const createTransporter = async (emailConfig, user) => {
  switch (emailConfig.provider) {
    case 'gmail':
      // For Gmail, we'll use Gmail API directly instead of SMTP
      // This works better with the gmail.send OAuth scope
      return null; // We'll handle Gmail differently in sendEmail function

    case 'godaddy':
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

const sendEmail = async (emailConfig, user, recipient, subject, body, trackingId) => {
  try {
    logger.info({ 
      recipient, 
      trackingId,
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

    // Add tracking pixel with multiple fallback methods
    const trackingUrl = `${process.env.APP_URL}/track/${trackingId}`;
    
    // Method 1: Standard img tag
    const trackingPixel = `<img src="${trackingUrl}" width="1" height="1" alt="" style="display:block;border:0;outline:none;" />`;
    
    // Method 2: Background image in a div (some email clients load this)
    const trackingDiv = `<div style="background-image:url('${trackingUrl}');width:1px;height:1px;"></div>`;
    
    // Method 3: CSS background (another fallback)
    const trackingStyle = `<table cellpadding="0" cellspacing="0" border="0" style="width:1px;height:1px;"><tr><td style="background:url('${trackingUrl}') no-repeat;width:1px;height:1px;"></td></tr></table>`;
    
    // Add all tracking methods + optional view in browser link
    const bodyWithTracking = body + trackingPixel + trackingDiv + trackingStyle;
    
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
      case 'smtp':
        const smtpTransporter = await createTransporter(emailConfig, user);
        await smtpTransporter.verify();
        return { success: true, message: emailConfig.provider === 'godaddy' ? 'GoDaddy SMTP connection successful' : 'SMTP connection successful' };

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
