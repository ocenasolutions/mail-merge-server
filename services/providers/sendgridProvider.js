const axios = require('axios');

const send = async ({ emailConfig, recipient, subject, htmlBody, textBody, attachments = [] }) => {
  const response = await axios.post(
    'https://api.sendgrid.com/v3/mail/send',
    {
      personalizations: [{ to: [{ email: recipient }] }],
      from: { email: emailConfig.config.email },
      subject,
      content: [
        { type: 'text/plain', value: textBody },
        { type: 'text/html', value: htmlBody }
      ],
      attachments: attachments.map((attachment) => ({
        content: Buffer.from(attachment.content).toString('base64'),
        filename: attachment.filename,
        type: attachment.contentType,
        disposition: attachment.disposition || 'attachment',
        content_id: attachment.cid
      }))
    },
    {
      headers: {
        Authorization: `Bearer ${emailConfig.config.apiKey}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return {
    success: true,
    providerMessageId: response.headers?.['x-message-id'] || response.data?.message_id || null,
    messageId: response.headers?.['x-message-id'] || response.data?.message_id || null,
    statusCode: response.status
  };
};

module.exports = {
  name: 'sendgrid',
  send
};
