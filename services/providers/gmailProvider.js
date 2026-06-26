const { google } = require('googleapis');
const User = require('../../models/User');
const { buildRawMimeMessage } = require('./utils');

const send = async ({ emailConfig, user, recipient, subject, htmlBody, textBody, trackingId, cc, bcc, attachments = [] }) => {
  const isPrimary = !emailConfig || emailConfig._id === 'gmail' || emailConfig.name === 'Primary Gmail';
  const refreshToken = isPrimary ? user?.googleRefreshToken : emailConfig?.gmailRefreshToken;
  const accessToken = isPrimary ? user?.googleAccessToken : emailConfig?.gmailAccessToken;

  if (!refreshToken) {
    if (isPrimary) {
      throw new Error('Google authentication expired. Please log out and log in again.');
    } else {
      throw new Error(`Gmail account (${emailConfig?.config?.email || 'selected account'}) is not authenticated or refresh token is missing. Please reconnect this account in Settings.`);
    }
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
  );

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken
  });

  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    if (credentials.access_token && credentials.access_token !== accessToken) {
      if (emailConfig?.gmailRefreshToken) {
        emailConfig.gmailAccessToken = credentials.access_token;
        await emailConfig.save();
      } else {
        await User.findByIdAndUpdate(user._id, { googleAccessToken: credentials.access_token });
      }
    }
  } catch (error) {
    if (!isPrimary) {
      throw new Error(`Failed to authenticate Gmail account (${emailConfig?.config?.email || 'selected account'}). Access may have been revoked. Please reconnect this account in Settings.`);
    }
    // For primary account, fall through to let the Google API return the direct error
  }

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const mimeBuffer = buildRawMimeMessage({
    from: emailConfig?.config?.email || user.email,
    to: recipient,
    subject,
    textBody,
    htmlBody,
    trackingId,
    cc,
    bcc,
    attachments
  }, { returnBuffer: true });

  const response = await gmail.users.messages.send({
    userId: 'me',
    media: {
      mimeType: 'message/rfc822',
      body: mimeBuffer
    }
  });

  return {
    success: true,
    providerMessageId: response.data?.id || null,
    messageId: response.data?.id || null,
    statusCode: response.status || 200
  };
};

module.exports = {
  name: 'gmail',
  send
};
