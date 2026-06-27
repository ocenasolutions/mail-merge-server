const axios = require('axios');

const send = async ({ emailConfig, recipient, subject, htmlBody, textBody, attachments = [] }) => {
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
