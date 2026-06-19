const nodemailer = require('nodemailer');

const resolveSesHost = (emailConfig) => (
  emailConfig.config.host ||
  (emailConfig.config.region ? `email-smtp.${emailConfig.config.region}.amazonaws.com` : null)
);

const send = async ({ emailConfig, user, recipient, subject, htmlBody, textBody, trackingId, cc, bcc, attachments = [] }) => {
  const transporter = nodemailer.createTransport({
    host: resolveSesHost(emailConfig),
    port: emailConfig.config.port || 587,
    secure: emailConfig.config.secure !== false,
    auth: {
      user: emailConfig.config.username || emailConfig.config.accessKeyId || emailConfig.config.apiKey,
      pass: emailConfig.config.password || emailConfig.config.secretAccessKey || emailConfig.config.apiSecret
    }
  });

  const response = await transporter.sendMail({
    from: emailConfig.config.email || user.email,
    to: recipient,
    subject,
    text: textBody,
    html: htmlBody,
    cc,
    bcc,
    headers: trackingId ? { 'X-Entity-Ref-ID': trackingId } : undefined,
    attachments: attachments.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.contentType,
      cid: attachment.cid,
      contentDisposition: attachment.disposition
    }))
  });

  return {
    success: true,
    providerMessageId: response.messageId || null,
    messageId: response.messageId || null,
    statusCode: 250
  };
};

module.exports = {
  name: 'ses',
  send
};
