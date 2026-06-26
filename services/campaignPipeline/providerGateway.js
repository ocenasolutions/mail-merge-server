const crypto = require('crypto');
const { sendEmail } = require('../emailService');
const { composeRecipientEmail } = require('./emailComposer');

const buildDeliveryContext = ({ campaign, recipient, user, emailConfig }) => {
  const { subject, body, mergeData } = composeRecipientEmail({ campaign, recipient, user });
  const idempotencyKey = recipient.idempotencyKey || crypto.createHash('sha256')
    .update(`${campaign._id}:${recipient._id}:${recipient.email}`)
    .digest('hex');

  return {
    subject,
    body,
    mergeData,
    idempotencyKey,
    recipientEmail: recipient.email,
    provider: emailConfig.provider
  };
};

const sendCampaignEmail = async ({ campaign, recipient, user, emailConfig, preResolvedAttachments = [] }) => {
  const delivery = buildDeliveryContext({ campaign, recipient, user, emailConfig });
  const result = await sendEmail(
    emailConfig,
    user,
    recipient.email,
    delivery.subject,
    delivery.body,
    recipient.trackingId,
    {
      trackingEnabled: campaign.trackingEnabled !== false,
      attachments: preResolvedAttachments.length > 0 ? preResolvedAttachments : (campaign.attachments || [])
    }
  );

  return {
    ...result,
    ...delivery,
    providerMessageId: result.providerMessageId || result.messageId || null
  };
};

module.exports = {
  buildDeliveryContext,
  sendCampaignEmail
};
