const Campaign = require('../models/Campaign');
const Recipient = require('../models/Recipient');
const Tracking = require('../models/Tracking');

exports.getDashboardStats = async (req, res) => {
  try {
    const userId = req.user._id;

    const totalCampaigns = await Campaign.countDocuments({ userId });
    const activeCampaigns = await Campaign.countDocuments({
      userId,
      status: { $in: ['sending', 'scheduled'] }
    });

    const campaigns = await Campaign.find({ userId });
    
    const stats = campaigns.reduce((acc, campaign) => {
      acc.totalSent += campaign.stats.sent;
      acc.totalOpened += campaign.stats.opened;
      acc.totalBounced += campaign.stats.bounced;
      return acc;
    }, { totalSent: 0, totalOpened: 0, totalBounced: 0 });

    const openRate = stats.totalSent > 0
      ? ((stats.totalOpened / stats.totalSent) * 100).toFixed(2)
      : 0;

    res.json({
      success: true,
      data: {
        totalCampaigns,
        activeCampaigns,
        ...stats,
        openRate: parseFloat(openRate)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getCampaignStats = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const recipients = await Recipient.find({ campaignId: campaign._id });
    const tracking = await Tracking.find({ campaignId: campaign._id });

    const openRate = campaign.stats.sent > 0
      ? ((campaign.stats.opened / campaign.stats.sent) * 100).toFixed(2)
      : 0;

    const bounceRate = campaign.stats.sent > 0
      ? ((campaign.stats.bounced / campaign.stats.sent) * 100).toFixed(2)
      : 0;

    res.json({
      success: true,
      data: {
        ...campaign.stats,
        openRate: parseFloat(openRate),
        bounceRate: parseFloat(bounceRate),
        recentOpens: tracking
          .flatMap(t => t.opens)
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 10)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getRecentActivity = async (req, res) => {
  try {
    const campaigns = await Campaign.find({ userId: req.user._id })
      .sort('-updatedAt')
      .limit(10)
      .select('name status stats updatedAt');

    const recipients = await Recipient.find({
      campaignId: { $in: campaigns.map(c => c._id) }
    })
      .sort('-sentAt')
      .limit(20)
      .populate('campaignId', 'name');

    res.json({
      success: true,
      data: {
        campaigns,
        recentSends: recipients
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
