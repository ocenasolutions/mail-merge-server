const axios = require('axios');

const parseEmails = (input) => {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(e => (typeof e === 'string' ? { email: e.trim() } : e)).filter(e => e.email);
  return String(input)
    .split(',')
    .map(e => e.trim())
    .filter(Boolean)
    .map(email => ({ email }));
};

const send = async ({ emailConfig, recipient, subject, htmlBody, textBody, cc, bcc, attachments = [] }) => {
  const payload = {
    personalizations: [{ to: [{ email: recipient }] }],
    from: { email: emailConfig.config.email },
    subject,
    content: [
      { type: 'text/plain', value: textBody },
      { type: 'text/html', value: htmlBody }
    ]
  };

  const ccEmails = parseEmails(cc);
  const bccEmails = parseEmails(bcc);
  if (ccEmails.length > 0) payload.personalizations[0].cc = ccEmails;
  if (bccEmails.length > 0) payload.personalizations[0].bcc = bccEmails;

  if (attachments && attachments.length > 0) {
    payload.attachments = attachments.map((attachment) => ({
      content: Buffer.from(attachment.content).toString('base64'),
      filename: attachment.filename,
      type: attachment.contentType,
      disposition: attachment.disposition || 'attachment',
      content_id: attachment.cid
    }));
  }

  const response = await axios.post(
    'https://api.sendgrid.com/v3/mail/send',
    payload,
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
