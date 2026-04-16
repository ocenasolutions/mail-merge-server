const { RateLimiterMemory } = require('rate-limiter-flexible');
const Campaign = require('../models/Campaign');
const Recipient = require('../models/Recipient');
const EmailConfig = require('../models/EmailConfig');
const User = require('../models/User');
const Sheet = require('../models/Sheet');
const Tracking = require('../models/Tracking');
const { sendEmail, mergeTags } = require('./emailService');
const { updateSheetWithStatus } = require('./googleSheetsService');
const logger = require('../utils/logger');

const rateLimiters = new Map();

const getRateLimiter = (userId, emailsPerMinute) => {
  if (!rateLimiters.has(userId)) {
    rateLimiters.set(
      userId,
      new RateLimiterMemory({
        points: emailsPerMinute,
        duration: 60
      })
    );
  }
  return rateLimiters.get(userId);
};

const updateGoogleSheetStatus = async (campaign, user) => {
  try {
    const sheet = await Sheet.findById(campaign.sheetId);
    if (!sheet) return;

    const recipients = await Recipient.find({ campaignId: campaign._id });
    const statusData = {};

    for (const recipient of recipients) {
      const tracking = await Tracking.findOne({ recipientId: recipient._id });
      
      let status = 'Not Delivered';
      if (recipient.status === 'sent') {
        status = tracking && tracking.openCount > 0 ? 'Opened' : 'Sent (Not Opened)';
      } else if (recipient.status === 'bounced') {
        status = 'Bounced';
      } else if (recipient.status === 'failed') {
        status = 'Failed';
      }

      statusData[recipient.email] = {
        status: status,
        sentAt: recipient.sentAt ? new Date(recipient.sentAt).toLocaleString() : '',
        openedAt: tracking?.firstOpenedAt ? new Date(tracking.firstOpenedAt).toLocaleString() : '',
        openCount: tracking?.openCount || 0
      };
    }

    await updateSheetWithStatus(
      sheet.sheetId,
      user.googleAccessToken,
      user.googleRefreshToken,
      campaign.emailColumn,
      statusData
    );

    logger.info({ campaignId: campaign._id, campaignName: campaign.name }, '✅ Google Sheet updated with email statuses');
  } catch (error) {
    logger.error({ err: error, campaignId: campaign._id }, 'Failed to update Google Sheet');
  }
};

const processCampaign = async (campaignId) => {
  try {
    const campaign = await Campaign.findById(campaignId)
      .populate('emailConfigId');

    if (!campaign || campaign.status !== 'sending') {
      return;
    }

    const user = await User.findById(campaign.userId);
    const rateLimiter = getRateLimiter(
      user._id.toString(),
      user.settings.emailsPerMinute
    );

    const recipients = await Recipient.find({
      campaignId: campaign._id,
      status: 'pending'
    }).limit(100);

    if (recipients.length === 0) {
      campaign.status = 'completed';
      campaign.completedAt = new Date();
      await campaign.save();
      return;
    }

    for (const recipient of recipients) {
      try {
        await rateLimiter.consume(user._id.toString());

        // Convert Map to plain object for merge tags
        const mergeData = recipient.mergeData instanceof Map 
          ? Object.fromEntries(recipient.mergeData)
          : recipient.mergeData;

        console.log('Merge data for', recipient.email, ':', mergeData);

        const subject = mergeTags(campaign.subject, mergeData);
        const body = mergeTags(campaign.body, mergeData);

        console.log('Merged subject:', subject);
        console.log('Merged body preview:', body.substring(0, 100));

        const result = await sendEmail(
          campaign.emailConfigId,
          user,
          recipient.email,
          subject,
          body,
          recipient.trackingId
        );

        if (result.success) {
          recipient.status = 'sent';
          recipient.sentAt = new Date();
          campaign.stats.sent += 1;
        } else {
          recipient.status = 'failed';
          recipient.error = result.error;
          campaign.stats.failed += 1;
        }

        await recipient.save();
      } catch (error) {
        if (error.msBeforeNext) {
          // Rate limit hit, wait and retry
          setTimeout(() => processCampaign(campaignId), error.msBeforeNext);
          break;
        } else {
          recipient.status = 'failed';
          recipient.error = error.message;
          campaign.stats.failed += 1;
          await recipient.save();
        }
      }
    }

    await campaign.save();

    // Continue processing if there are more recipients
    const remaining = await Recipient.countDocuments({
      campaignId: campaign._id,
      status: 'pending'
    });

    if (remaining > 0 && campaign.status === 'sending') {
      setTimeout(() => processCampaign(campaignId), 1000);
    } else if (remaining === 0) {
      campaign.status = 'completed';
      campaign.completedAt = new Date();
      await campaign.save();
      
      logger.info({ 
        campaignId: campaign._id,
        campaignName: campaign.name,
        stats: campaign.stats
      }, '✅ Campaign completed');
      
      // Update Google Sheet with final status
      await updateGoogleSheetStatus(campaign, user);
    }
  } catch (error) {
    logger.error({ err: error, campaignId }, 'Campaign processing error');
    const campaign = await Campaign.findById(campaignId);
    if (campaign) {
      campaign.status = 'failed';
      await campaign.save();
      logger.error({ campaignId: campaign._id, campaignName: campaign.name }, '❌ Campaign failed');
    }
  }
};

module.exports = {
  processCampaign
};
