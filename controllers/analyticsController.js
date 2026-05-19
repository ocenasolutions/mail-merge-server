const Campaign = require('../models/Campaign');
const Recipient = require('../models/Recipient');
const Tracking = require('../models/Tracking');
const { syncUserReplyStats } = require('../services/replyTrackingService');

const withRates = (sent, opened, clicked, bounced, replied) => ({
  openRate: sent > 0 ? Number(((opened / sent) * 100).toFixed(2)) : 0,
  clickRate: sent > 0 ? Number(((clicked / sent) * 100).toFixed(2)) : 0,
  bounceRate: sent > 0 ? Number(((bounced / sent) * 100).toFixed(2)) : 0,
  replyRate: sent > 0 ? Number(((replied / sent) * 100).toFixed(2)) : 0
});

exports.getDashboardStats = async (req, res) => {
  try {
    const userId = req.user._id;
    await syncUserReplyStats(userId).catch(() => null);

    const totalCampaigns = await Campaign.countDocuments({ userId });
    const activeCampaigns = await Campaign.countDocuments({
      userId,
      status: { $in: ['sending', 'scheduled'] }
    });

    const campaigns = await Campaign.find({ userId });

    const stats = campaigns.reduce((acc, campaign) => {
      acc.totalSent += campaign.stats.sent || 0;
      acc.totalOpened += campaign.stats.opened || 0;
      acc.totalBounced += campaign.stats.bounced || 0;
      acc.totalClicked += campaign.stats.clicked || 0;
      acc.totalReplies += campaign.stats.replied || 0;
      return acc;
    }, { totalSent: 0, totalOpened: 0, totalBounced: 0, totalClicked: 0, totalReplies: 0 });

    res.json({
      success: true,
      data: {
        totalCampaigns,
        activeCampaigns,
        ...stats,
        ...withRates(stats.totalSent, stats.totalOpened, stats.totalClicked, stats.totalBounced, stats.totalReplies)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getCampaignStats = async (req, res) => {
  try {
    await syncUserReplyStats(req.user._id).catch(() => null);

    const campaign = await Campaign.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const recipients = await Recipient.find({ campaignId: campaign._id });
    const tracking = await Tracking.find({ campaignId: campaign._id });
    const repliedRecipients = recipients.filter((recipient) => (recipient.replyCount || 0) > 0);

    res.json({
      success: true,
      data: {
        ...campaign.stats,
        recipientCount: recipients.length,
        replied: repliedRecipients.length,
        ...withRates(
          campaign.stats.sent || 0,
          campaign.stats.opened || 0,
          campaign.stats.clicked || 0,
          campaign.stats.bounced || 0,
          repliedRecipients.length
        ),
        recentOpens: tracking
          .flatMap((item) => item.opens)
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 10),
        recentReplies: repliedRecipients
          .filter((recipient) => recipient.repliedAt)
          .sort((a, b) => new Date(b.repliedAt).getTime() - new Date(a.repliedAt).getTime())
          .slice(0, 10)
          .map((recipient) => ({
            email: recipient.email,
            repliedAt: recipient.repliedAt,
            replyCount: recipient.replyCount || 0
          }))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getRecentActivity = async (req, res) => {
  try {
    await syncUserReplyStats(req.user._id).catch(() => null);

    const campaigns = await Campaign.find({ userId: req.user._id })
      .sort('-updatedAt')
      .limit(10)
      .select('name status stats updatedAt');

    const recipients = await Recipient.find({
      campaignId: { $in: campaigns.map((c) => c._id) }
    })
      .sort('-sentAt')
      .limit(20)
      .populate('campaignId', 'name');

    const recentReplies = await Recipient.find({
      campaignId: { $in: campaigns.map((c) => c._id) },
      repliedAt: { $ne: null }
    })
      .sort('-repliedAt')
      .limit(20)
      .populate('campaignId', 'name');

    res.json({
      success: true,
      data: {
        campaigns,
        recentSends: recipients,
        recentReplies: recentReplies.map((recipient) => ({
          email: recipient.email,
          campaignName: recipient.campaignId?.name || 'Campaign',
          repliedAt: recipient.repliedAt,
          replyCount: recipient.replyCount || 0
        }))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getRecentOpens = async (req, res) => {
  try {
    const campaigns = await Campaign.find({ userId: req.user._id }).select('_id name');
    const campaignIds = campaigns.map((campaign) => campaign._id);
    const campaignMap = new Map(campaigns.map((campaign) => [campaign._id.toString(), campaign.name]));

    const trackingDocs = await Tracking.find({ campaignId: { $in: campaignIds } })
      .sort('-lastOpenedAt')
      .limit(50);

    const recipientIds = trackingDocs.map((doc) => doc.recipientId);
    const recipients = await Recipient.find({ _id: { $in: recipientIds } }).select('email campaignId');
    const recipientMap = new Map(recipients.map((recipient) => [recipient._id.toString(), recipient]));

    const recentOpens = trackingDocs
      .filter((doc) => doc.openCount > 0)
      .map((doc) => {
        const recipient = recipientMap.get(doc.recipientId.toString());
        return {
          trackingId: doc._id,
          email: recipient?.email || 'Unknown recipient',
          campaignId: recipient?.campaignId || doc.campaignId,
          campaignName: campaignMap.get(doc.campaignId.toString()) || 'Campaign',
          openCount: doc.openCount,
          firstOpenedAt: doc.firstOpenedAt,
          lastOpenedAt: doc.lastOpenedAt
        };
      })
      .sort((a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime())
      .slice(0, 25);

    res.json({ success: true, data: recentOpens });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
