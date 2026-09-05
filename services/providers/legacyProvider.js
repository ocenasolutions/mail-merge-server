const axios = require('axios');

const parseEmailList = (input) => {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(e => (typeof e === 'string' ? { email: e.trim() } : e)).filter(e => e.email);
  return String(input)
    .split(',')
    .map(e => e.trim())
    .filter(Boolean)
    .map(email => ({ email }));
};

const send = async ({ emailConfig, recipient, subject, htmlBody, textBody, cc, bcc, attachments = [] }) => {
  switch (emailConfig.provider) {
    case 'brevo': {
      const payload = {
        sender: {
          email: emailConfig.config.email,
          name: emailConfig.config.fromName || emailConfig.config.email?.split('@')[0] || 'Mail Merge'
        },
        to: [{ email: recipient }],
        subject,
        textContent: textBody,
        htmlContent: htmlBody
      };

      const ccList = parseEmailList(cc);
      const bccList = parseEmailList(bcc);
      if (ccList.length > 0) payload.cc = ccList;
      if (bccList.length > 0) payload.bcc = bccList;

      if (attachments && attachments.length > 0) {
        payload.attachment = attachments.map((attachment) => ({
          name: attachment.filename,
          content: Buffer.from(attachment.content).toString('base64'),
          contentId: attachment.cid
        }));
      }

      const response = await axios.post('https://api.brevo.com/v3/smtp/email', payload, {
        headers: {
          'api-key': emailConfig.config.apiKey,
          'Content-Type': 'application/json'
        }
      });

      return {
        success: true,
        providerMessageId: response.data?.messageId || response.data?.id || null,
        messageId: response.data?.messageId || response.data?.id || null,
        statusCode: response.status
      };
    }

    case 'mailgun': {
      const formData = new URLSearchParams();
      formData.append('from', emailConfig.config.email);
      formData.append('to', recipient);
      formData.append('subject', subject);
      formData.append('text', textBody);
      formData.append('html', htmlBody);
      if (cc) formData.append('cc', Array.isArray(cc) ? cc.join(',') : cc);
      if (bcc) formData.append('bcc', Array.isArray(bcc) ? bcc.join(',') : bcc);
      attachments.forEach((attachment) => {
        formData.append('attachment', `data:${attachment.contentType};base64,${Buffer.from(attachment.content).toString('base64')}`);
      });

      const response = await axios.post(
        `https://api.mailgun.net/v3/${emailConfig.config.domain}/messages`,
        formData,
        {
          auth: {
            username: 'api',
            password: emailConfig.config.apiKey
          }
        }
      );

      return {
        success: true,
        providerMessageId: response.data?.id || null,
        messageId: response.data?.id || null,
        statusCode: response.status
      };
    }

    default:
      throw new Error(`Unsupported legacy provider: ${emailConfig.provider}`);
  }
};

module.exports = {
  name: 'legacy',
  send
};
