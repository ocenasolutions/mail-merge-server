const Campaign = require('../models/Campaign');
const Recipient = require('../models/Recipient');
const Tracking = require('../models/Tracking');
const { syncUserReplyStats } = require('../services/replyTrackingService');
const { syncAllCampaignStatsForUser } = require('../services/campaignStatsService');

const lastSyncMap = new Map();

const throttleSync = (userId) => {
  const now = Date.now();
  const lastSync = lastSyncMap.get(String(userId)) || 0;
  // Limit on-demand syncs to once every 5 minutes (300,000 ms) per user
  if (now - lastSync > 5 * 60 * 1000) {
    lastSyncMap.set(String(userId), now);
    // Run sync in the background so it doesn't block the API response
    Promise.all([
      syncAllCampaignStatsForUser(userId).catch(() => null),
      syncUserReplyStats(userId).catch(() => null)
    ]);
  }
};

const withRates = (sent, opened, clicked, bounced, replied) => ({
  openRate: sent > 0 ? Number(((opened / sent) * 100).toFixed(2)) : 0,
  clickRate: sent > 0 ? Number(((clicked / sent) * 100).toFixed(2)) : 0,
  bounceRate: sent > 0 ? Number(((bounced / sent) * 100).toFixed(2)) : 0,
  replyRate: sent > 0 ? Number(((replied / sent) * 100).toFixed(2)) : 0
});

const getNormalizedAccountId = (accountId) => {
  if (!accountId || accountId === 'all') {
    return null;
  }

  return String(accountId);
};

const getCampaignSenderEmail = (campaign) => (
  campaign.senderEmail
  || campaign.emailConfigId?.config?.email
  || campaign.emailConfigId?.email
  || ''
);

const filterCampaignsByAccount = (campaigns, accountId, userEmail) => {
  const normalizedAccountId = getNormalizedAccountId(accountId);
  if (!normalizedAccountId) {
    return campaigns;
  }

  if (normalizedAccountId === 'gmail') {
    const normalizedUserEmail = String(userEmail || '').toLowerCase();
    return campaigns.filter((campaign) => getCampaignSenderEmail(campaign).toLowerCase() === normalizedUserEmail);
  }

  return campaigns.filter((campaign) => String(campaign.emailConfigId?._id || campaign.emailConfigId || '') === normalizedAccountId);
};

exports.getDashboardStats = async (req, res) => {
  try {
    const userId = req.user._id;
    await throttleSync(userId);

    const campaigns = filterCampaignsByAccount(
      await Campaign.find({ userId }).populate('emailConfigId', 'email config.email'),
      req.query.accountId,
      req.user.email
    );
    const totalCampaigns = campaigns.length;
    const activeCampaigns = campaigns.filter((campaign) => ['sending', 'scheduled'].includes(campaign.status)).length;
    const campaignIds = campaigns.map((campaign) => campaign._id);
    const [trackingDocs, repliedRecipients] = await Promise.all([
      Tracking.find({ campaignId: { $in: campaignIds } }).select('openCount clickCount'),
      Recipient.find({
        campaignId: { $in: campaignIds },
        replyCount: { $gt: 0 }
      }).select('_id')
    ]);

    const stats = campaigns.reduce((acc, campaign) => {
      acc.totalSent += campaign.stats.sent || 0;
      acc.totalBounced += campaign.stats.bounced || 0;
      return acc;
    }, { totalSent: 0, totalOpened: 0, totalBounced: 0, totalClicked: 0, totalReplies: 0 });

    stats.totalOpened = trackingDocs.filter((doc) => (doc.openCount || 0) > 0).length;
    stats.totalClicked = trackingDocs.filter((doc) => (doc.clickCount || 0) > 0).length;
    stats.totalReplies = repliedRecipients.length;

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
    await throttleSync(req.user._id);

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

    const trackingMap = new Map(tracking.map((t) => [String(t.recipientId), t]));

    let primarySentCount = 0;
    let fallbackSentCount = 0;
    let successfulDeliveries = 0;
    let failedDeliveries = 0;
    let followUpsPending = 0;
    let openedCount = 0;

    recipients.forEach((r) => {
      const isSent = r.status === 'sent';
      const isFailed = ['failed', 'bounced'].includes(r.status);
      const track = trackingMap.get(String(r._id));
      const hasOpened = (track?.openCount || 0) > 0;
      const hasReplied = (r.replyCount || 0) > 0;

      if (isSent) {
        successfulDeliveries++;
        if (r.isFallbackUsed) {
          fallbackSentCount++;
        } else {
          primarySentCount++;
        }
      }
      if (isFailed) {
        failedDeliveries++;
      }
      if (hasOpened) {
        openedCount++;
      }
      if (isSent && hasOpened && !hasReplied && r.followUpStatus !== 'sent') {
        followUpsPending++;
      }
    });

    const totalTargeted = recipients.length;
    const deliveryRate = totalTargeted > 0 ? Number(((successfulDeliveries / totalTargeted) * 100).toFixed(2)) : 0;
    const openRate = successfulDeliveries > 0 ? Number(((openedCount / successfulDeliveries) * 100).toFixed(2)) : 0;
    const replyRate = successfulDeliveries > 0 ? Number(((repliedRecipients.length / successfulDeliveries) * 100).toFixed(2)) : 0;

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
        summaryMetrics: {
          totalTargeted,
          emailsSent: campaign.stats.sent || (successfulDeliveries + failedDeliveries),
          successfulDeliveries,
          failedDeliveries,
          deliveryRate,
          openRate,
          replyRate,
          followUpsPending,
          primarySentCount,
          fallbackSentCount
        },
        recentOpens: tracking
          .flatMap((item) => item.opens || [])
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 10),
        recentClicks: tracking
          .flatMap((item) => (item.clicks || []).map((click) => ({
            ...click,
            recipientId: item.recipientId,
            campaignId: item.campaignId
          })))
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

exports.getRecentClicks = async (req, res) => {
  try {
    await throttleSync(req.user._id);
    const campaigns = filterCampaignsByAccount(
      await Campaign.find({ userId: req.user._id })
      .populate('emailConfigId', 'email config.email')
      .select('_id name senderEmail emailConfigId'),
      req.query.accountId,
      req.user.email
    );
    const campaignIds = campaigns.map((campaign) => campaign._id);
    const campaignMap = new Map(campaigns.map((campaign) => [campaign._id.toString(), campaign.name]));

    const trackingDocs = await Tracking.find({ campaignId: { $in: campaignIds } })
      .sort('-updatedAt')
      .limit(100);

    const recipientIds = trackingDocs.map((doc) => doc.recipientId);
    const recipients = await Recipient.find({ _id: { $in: recipientIds } }).select('email campaignId');
    const recipientMap = new Map(recipients.map((recipient) => [recipient._id.toString(), recipient]));

    const recentClicks = trackingDocs
      .flatMap((doc) => (doc.clicks || []).map((click, index) => {
        const recipient = recipientMap.get(doc.recipientId.toString());
        return {
          clickId: `${doc._id}-${index}`,
          email: recipient?.email || 'Unknown recipient',
          campaignId: recipient?.campaignId || doc.campaignId,
          campaignName: campaignMap.get(doc.campaignId.toString()) || 'Campaign',
          url: click.url,
          timestamp: click.timestamp,
          clickCount: doc.clickCount || 0
        };
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 25);

    res.json({ success: true, data: recentClicks });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getRecentActivity = async (req, res) => {
  try {
    await throttleSync(req.user._id);

    const campaigns = filterCampaignsByAccount(
      await Campaign.find({ userId: req.user._id })
      .populate('emailConfigId', 'email config.email')
      .sort('-updatedAt')
      .limit(10)
      .select('name status stats updatedAt senderEmail emailConfigId'),
      req.query.accountId,
      req.user.email
    );
    const campaignIds = campaigns.map((campaign) => campaign._id);

    const recipients = await Recipient.find({
      campaignId: { $in: campaignIds }
    })
      .sort('-sentAt')
      .limit(20)
      .populate('campaignId', 'name');

    const recentReplies = await Recipient.find({
      campaignId: { $in: campaignIds },
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
    const campaigns = filterCampaignsByAccount(
      await Campaign.find({ userId: req.user._id })
      .populate('emailConfigId', 'email config.email')
      .select('_id name senderEmail emailConfigId'),
      req.query.accountId,
      req.user.email
    );
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

exports.getLeads = async (req, res) => {
  try {
    await throttleSync(req.user._id);

    const campaigns = filterCampaignsByAccount(
      await Campaign.find({ userId: req.user._id })
      .populate('emailConfigId', 'email config.email')
      .select('_id name senderEmail emailConfigId'),
      req.query.accountId,
      req.user.email
    );
    const campaignMap = new Map(campaigns.map((campaign) => [String(campaign._id), campaign.name]));

    const recipients = await Recipient.find({
      campaignId: { $in: campaigns.map((campaign) => campaign._id) },
      replyCount: { $gt: 0 }
    })
      .sort({ leadScore: -1, repliedAt: -1 })
      .limit(100);

    res.json({
      success: true,
      data: recipients.map((recipient) => ({
        name: recipient.mergeData?.get?.('name') || recipient.mergeData?.get?.('Name') || '',
        company: recipient.mergeData?.get?.('company') || recipient.mergeData?.get?.('Company') || '',
        id: String(recipient._id),
        email: recipient.email,
        repliedAt: recipient.repliedAt,
        replyCount: recipient.replyCount || 0,
        latestReplySnippet: recipient.latestReplySnippet || '',
        leadStatus: recipient.leadStatus || 'unknown',
        leadScore: recipient.leadScore || 0,
        leadReason: recipient.leadReason || 'Reply detected',
        campaignId: String(recipient.campaignId),
        campaignName: campaignMap.get(String(recipient.campaignId)) || 'Campaign',
        sentSubject: recipient.sentSubject || ''
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getFollowUps = async (req, res) => {
  try {
    await throttleSync(req.user._id);
    const MIN_DAYS_BEFORE_FOLLOW_UP = Math.max(1, Number(req.user?.settings?.followUpDelayDays || 1));

    const campaigns = filterCampaignsByAccount(
      await Campaign.find({ userId: req.user._id })
      .populate('emailConfigId', 'email config.email')
      .select('_id name senderEmail emailConfigId'),
      req.query.accountId,
      req.user.email
    );
    const campaignIds = campaigns.map((campaign) => campaign._id);
    const campaignMap = new Map(campaigns.map((campaign) => [String(campaign._id), campaign.name]));

    const recipients = await Recipient.find({
      campaignId: { $in: campaignIds },
      status: 'sent',
      replyCount: 0,
      sentAt: { $ne: null }
    })
      .sort({ sentAt: -1 })
      .limit(200);

    const recipientIds = recipients.map((recipient) => recipient._id);
    const trackingDocs = await Tracking.find({
      recipientId: { $in: recipientIds },
      openCount: { $gt: 0 }
    });

    const trackingMap = new Map(trackingDocs.map((doc) => [String(doc.recipientId), doc]));

    const data = recipients
      .map((recipient) => {
        const tracking = trackingMap.get(String(recipient._id));
        if (!tracking) return null;

        const daysSinceSent = recipient.sentAt
          ? Math.floor((Date.now() - new Date(recipient.sentAt).getTime()) / (1000 * 60 * 60 * 24))
          : 0;

        if (daysSinceSent < MIN_DAYS_BEFORE_FOLLOW_UP) {
          return null;
        }

        return {
          id: String(recipient._id),
          email: recipient.email,
          campaignId: String(recipient.campaignId),
          campaignName: campaignMap.get(String(recipient.campaignId)) || 'Campaign',
          sentAt: recipient.sentAt,
          openCount: tracking.openCount || 0,
          firstOpenedAt: tracking.firstOpenedAt || null,
          lastOpenedAt: tracking.lastOpenedAt || null,
          daysSinceSent
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const openDiff = (b.openCount || 0) - (a.openCount || 0);
        if (openDiff !== 0) return openDiff;
        return new Date(b.lastOpenedAt || 0).getTime() - new Date(a.lastOpenedAt || 0).getTime();
      });

    res.json({
      success: true,
      data
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
