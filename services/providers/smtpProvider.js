const nodemailer = require('nodemailer');

const buildTransportOptions = (emailConfig) => ({
  host: emailConfig.config.host || emailConfig.smtpHost,
  port: emailConfig.config.port || emailConfig.smtpPort,
  secure: emailConfig.config.secure !== false,
  auth: {
    user: emailConfig.config.username || emailConfig.smtpUsername,
    pass: emailConfig.config.password || emailConfig.smtpPassword
  },
  connectionTimeout: 60000,
  greetingTimeout: 30000,
  socketTimeout: 60000,
  logger: false,
  debug: false
});

const send = async ({ emailConfig, user, recipient, subject, htmlBody, textBody, trackingId, cc, bcc, attachments = [] }) => {
  const transporter = nodemailer.createTransport(buildTransportOptions(emailConfig));
  const mailOptions = {
    from: emailConfig.config.email || user.email,
    to: recipient,
    subject,
    text: textBody,
    html: htmlBody,
    attachments: attachments.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.contentType,
      cid: attachment.cid,
      contentDisposition: attachment.disposition
    }))
  };

  if (cc) mailOptions.cc = cc;
  if (bcc) mailOptions.bcc = bcc;
  if (trackingId) {
    mailOptions.headers = {
      'X-Entity-Ref-ID': trackingId
    };
  }

  const response = await transporter.sendMail(mailOptions);

  return {
    success: true,
    providerMessageId: response.messageId || null,
    messageId: response.messageId || null,
    statusCode: 250
  };
};

module.exports = {
  name: 'smtp',
  send
};
