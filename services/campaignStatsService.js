const Campaign = require('../models/Campaign');
const Recipient = require('../models/Recipient');
const Tracking = require('../models/Tracking');

const buildStatsFromRecipients = async (campaignId) => {
  const [recipients, trackingDocs] = await Promise.all([
    Recipient.find({ campaignId }).select('status replyCount error'),
    Tracking.find({ campaignId }).select('openCount clickCount')
  ]);

  const total = recipients.length;
  const sent = recipients.filter((recipient) => recipient.status === 'sent').length;
  const failed = recipients.filter((recipient) => recipient.status === 'failed').length;
  const bounced = recipients.filter((recipient) => recipient.status === 'bounced').length;
  const replied = recipients.filter((recipient) => (recipient.replyCount || 0) > 0).length;
  const opened = trackingDocs.filter((doc) => (doc.openCount || 0) > 0).length;
  const clicked = trackingDocs.filter((doc) => (doc.clickCount || 0) > 0).length;
  const pending = recipients.filter((recipient) => recipient.status === 'pending').length;

  return {
    total,
    sent,
    failed,
    bounced,
    opened,
    clicked,
    replied,
    pending
  };
};

const syncCampaignStats = async (campaignOrId) => {
  const campaign = typeof campaignOrId === 'object' && campaignOrId !== null
    ? campaignOrId
    : await Campaign.findById(campaignOrId);

  if (!campaign) {
    return null;
  }

  const stats = await buildStatsFromRecipients(campaign._id);
  campaign.stats = {
    total: stats.total,
    sent: stats.sent,
    failed: stats.failed,
    bounced: stats.bounced,
    opened: stats.opened,
    clicked: stats.clicked,
    replied: stats.replied
  };

  if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
    if (stats.pending > 0) {
      campaign.status = 'sending';
    } else if (stats.sent > 0 || stats.failed > 0 || stats.bounced > 0) {
      campaign.status = 'completed';
      if (!campaign.completedAt) {
        campaign.completedAt = new Date();
      }
    } else {
      campaign.status = 'failed';
    }
  }

  await campaign.save();
  return campaign;
};

const syncAllCampaignStatsForUser = async (userId) => {
  const campaigns = await Campaign.find({ userId });
  const updated = [];

  for (const campaign of campaigns) {
    updated.push(await syncCampaignStats(campaign));
  }

  return updated.filter(Boolean);
};

module.exports = {
  buildStatsFromRecipients,
  syncCampaignStats,
  syncAllCampaignStatsForUser
};
