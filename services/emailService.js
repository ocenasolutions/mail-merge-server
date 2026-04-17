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

      let accessToken;
      try {
        const tokenResponse = await oauth2Client.getAccessToken();
        accessToken = tokenResponse.token;
      } catch (error) {
        throw new Error('Failed to get Gmail access token. Please log out and log in again.');
      }

      return nodemailer.createTransport({
        service: 'gmail',
        auth: {
          type: 'OAuth2',
          user: emailConfig.config.email || user.email,
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          refreshToken: user.googleRefreshToken,
          accessToken: accessToken
        }
      });

    case 'godaddy':
    case 'smtp':
      return nodemailer.createTransport({
        host: emailConfig.config.host,
        port: emailConfig.config.port,
        secure: emailConfig.config.secure !== false, // Default to true for GoDaddy
        auth: {
          user: emailConfig.config.username,
          pass: emailConfig.config.password
        }
      });

    default:
      throw new Error('Unsupported email provider');
  }
};

const sendEmail = async (emailConfig, user, recipient, subject, body, trackingId) => {
  try {
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
      provider: emailConfig.provider
    }, '📧 Sending email with tracking pixel');

    switch (emailConfig.provider) {
      case 'gmail':
      case 'godaddy':
      case 'smtp':
        const transporter = await createTransporter(emailConfig, user);
        
        await transporter.sendMail({
          from: emailConfig.config.email || user.email,
          to: recipient,
          subject,
          html: bodyWithTracking,
          headers: {
            'X-Entity-Ref-ID': trackingId,
            'List-Unsubscribe': `<${process.env.APP_URL}/unsubscribe/${trackingId}>`,
          }
        });
        break;

      case 'sendgrid':
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
        break;

      case 'mailgun':
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
        break;

      case 'brevo':
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
        break;

      default:
        throw new Error('Unsupported email provider');
    }

    return { success: true };
  } catch (error) {
    logger.error({ err: error, recipient }, 'Email send error');
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

        const transporter = await createTransporter(emailConfig, user);
        await transporter.verify();
        return { success: true, message: 'Gmail connection successful' };

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
