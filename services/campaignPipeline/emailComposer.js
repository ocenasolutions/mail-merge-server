const { mergeTags } = require('../emailService');

const normalizeMergeData = (mergeData) => {
  if (!mergeData) return {};
  if (mergeData instanceof Map) {
    return Object.fromEntries(mergeData);
  }
  return { ...mergeData };
};

const resolveSignatureHtml = (campaign, user) => {
  if (campaign.useSignature === false) {
    return '';
  }

  const campaignSignatureHtml = campaign.signatureHtml || '';
  const fallbackSignatureHtml = user?.settings?.signature?.enabled && user?.settings?.signature?.html
    ? user.settings.signature.html
    : '';

  return campaignSignatureHtml || fallbackSignatureHtml || '';
};

const composeRecipientEmail = ({ campaign, recipient, user }) => {
  const mergeData = normalizeMergeData(recipient.mergeData);
  const subject = mergeTags(campaign.subject, mergeData);
  let body = mergeTags(campaign.htmlBody || campaign.body, mergeData);
  const signatureHtml = resolveSignatureHtml(campaign, user);

  if (signatureHtml) {
    body = `${body}${signatureHtml}`;
  }

  return {
    subject,
    body,
    mergeData
  };
};

module.exports = {
  composeRecipientEmail,
  normalizeMergeData,
  resolveSignatureHtml
};
