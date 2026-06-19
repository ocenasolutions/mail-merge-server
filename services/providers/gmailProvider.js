const { google } = require('googleapis');
const User = require('../../models/User');
const { buildRawMimeMessage } = require('./utils');

const send = async ({ emailConfig, user, recipient, subject, htmlBody, textBody, trackingId, cc, bcc, attachments = [] }) => {
  if (!user?.googleRefreshToken) {
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

  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    if (credentials.access_token && credentials.access_token !== user.googleAccessToken) {
      await User.findByIdAndUpdate(user._id, { googleAccessToken: credentials.access_token });
    }
  } catch (error) {
    // Token refresh failures fall through to the send call, which returns the actionable provider error.
  }

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const raw = buildRawMimeMessage({
    from: emailConfig.config.email || user.email,
    to: recipient,
    subject,
    textBody,
    htmlBody,
    trackingId,
    cc,
    bcc,
    attachments
  });

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw }
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
