const Campaign = require('../models/Campaign');
const Recipient = require('../models/Recipient');
const Tracking = require('../models/Tracking');

const buildStatsFromRecipients = async (campaignId) => {
  // Use aggregation instead of loading all recipients into memory.
  const [recipientStats, trackingStats] = await Promise.all([
    Recipient.aggregate([
      { $match: { campaignId } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          sent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          bounced: { $sum: { $cond: [{ $eq: ['$status', 'bounced'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          replied: {
            $sum: { $cond: [{ $gt: [{ $ifNull: ['$replyCount', 0] }, 0] }, 1, 0] }
          }
        }
      }
    ]),
    Tracking.aggregate([
      { $match: { campaignId } },
      {
        $group: {
          _id: null,
          opened: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$openCount', 0] }, 0] }, 1, 0] } },
          clicked: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$clickCount', 0] }, 0] }, 1, 0] } }
        }
      }
    ])
  ]);

  const r = recipientStats[0] || { total: 0, sent: 0, failed: 0, bounced: 0, pending: 0, replied: 0 };
  const t = trackingStats[0] || { opened: 0, clicked: 0 };

  return {
    total: r.total,
    sent: r.sent,
    failed: r.failed,
    bounced: r.bounced,
    opened: t.opened,
    clicked: t.clicked,
    replied: r.replied,
    pending: r.pending
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
  // Only sync campaigns that can still change — skip old completed ones
  // unless they were completed in the last 7 days.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const campaigns = await Campaign.find({
    userId,
    $or: [
      { status: { $in: ['sending', 'paused', 'scheduled'] } },
      { status: 'completed', completedAt: { $gte: sevenDaysAgo } }
    ]
  });

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