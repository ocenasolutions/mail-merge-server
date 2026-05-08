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
        sentAt: recipient.sentAt || '',
        openedAt: tracking?.firstOpenedAt || '',
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
    logger.info({ campaignId }, '🚀 Starting campaign processing');
    
    const campaign = await Campaign.findById(campaignId)
      .populate('emailConfigId');

    if (!campaign) {
      logger.error({ campaignId }, '❌ Campaign not found');
      return;
    }

    if (campaign.status !== 'sending') {
      logger.warn({ campaignId, status: campaign.status }, '⚠️ Campaign not in sending status');
      return;
    }

    logger.info({ 
      campaignId: campaign._id,
      campaignName: campaign.name,
      emailConfigId: campaign.emailConfigId?._id,
      emailConfigProvider: campaign.emailConfigId?.provider
    }, '📧 Campaign details loaded');

    if (!campaign.emailConfigId) {
      logger.error({ campaignId }, '❌ Email config not found for campaign');
      campaign.status = 'failed';
      await campaign.save();
      return;
    }

    const user = await User.findById(campaign.userId);
    
    if (!user) {
      logger.error({ campaignId, userId: campaign.userId }, '❌ User not found');
      campaign.status = 'failed';
      await campaign.save();
      return;
    }

    logger.info({ 
      userId: user._id,
      userEmail: user.email,
      hasGoogleAccessToken: !!user.googleAccessToken,
      hasGoogleRefreshToken: !!user.googleRefreshToken,
      emailsPerMinute: user.settings.emailsPerMinute
    }, '👤 User details loaded');

    const rateLimiter = getRateLimiter(
      user._id.toString(),
      user.settings.emailsPerMinute
    );

    const recipients = await Recipient.find({
      campaignId: campaign._id,
      status: 'pending'
    }).limit(100);

    logger.info({ 
      campaignId,
      pendingRecipients: recipients.length,
      totalRecipients: campaign.stats.total
    }, '📋 Recipients loaded');

    if (recipients.length === 0) {
      campaign.status = 'completed';
      campaign.completedAt = new Date();
      await campaign.save();
      logger.info({ campaignId }, '✅ Campaign completed - no more recipients');
      return;
    }

    let processedCount = 0;
    let successCount = 0;
    let failedCount = 0;

    for (const recipient of recipients) {
      try {
        logger.info({ 
          recipientEmail: recipient.email,
          trackingId: recipient.trackingId
        }, '📤 Processing recipient');

        await rateLimiter.consume(user._id.toString());

        // Convert Map to plain object for merge tags
        const mergeData = recipient.mergeData instanceof Map 
          ? Object.fromEntries(recipient.mergeData)
          : recipient.mergeData;

        logger.info({ 
          recipientEmail: recipient.email,
          mergeDataKeys: Object.keys(mergeData || {})
        }, '🔄 Merge data prepared');

        const subject = mergeTags(campaign.subject, mergeData);
        const body = mergeTags(campaign.body, mergeData);

        logger.info({ 
          recipientEmail: recipient.email,
          subject: subject,
          bodyLength: body?.length || 0
        }, '📝 Email content merged');

        const result = await sendEmail(
          campaign.emailConfigId,
          user,
          recipient.email,
          subject,
          body,
          recipient.trackingId
        );

        logger.info({ 
          recipientEmail: recipient.email,
          success: result.success,
          error: result.error
        }, result.success ? '✅ Email sent successfully' : '❌ Email send failed');

        if (result.success) {
          recipient.status = 'sent';
          recipient.sentAt = new Date();
          campaign.stats.sent += 1;
          successCount++;
        } else {
          recipient.status = 'failed';
          recipient.error = result.error;
          campaign.stats.failed += 1;
          failedCount++;
        }

        await recipient.save();
        processedCount++;
      } catch (error) {
        logger.error({ 
          err: error,
          recipientEmail: recipient.email,
          errorMessage: error.message,
          msBeforeNext: error.msBeforeNext
        }, '❌ Error processing recipient');

        if (error.msBeforeNext) {
          // Rate limit hit, wait and retry
          logger.warn({ 
            msBeforeNext: error.msBeforeNext,
            processedCount,
            successCount,
            failedCount
          }, '⏸️ Rate limit hit, scheduling retry');
          setTimeout(() => processCampaign(campaignId), error.msBeforeNext);
          break;
        } else {
          recipient.status = 'failed';
          recipient.error = error.message;
          campaign.stats.failed += 1;
          failedCount++;
          await recipient.save();
        }
      }
    }

    await campaign.save();

    logger.info({ 
      campaignId,
      processedCount,
      successCount,
      failedCount,
      totalSent: campaign.stats.sent,
      totalFailed: campaign.stats.failed
    }, '📊 Batch processing complete');

    // Continue processing if there are more recipients
    const remaining = await Recipient.countDocuments({
      campaignId: campaign._id,
      status: 'pending'
    });

    logger.info({ 
      campaignId,
      remainingRecipients: remaining
    }, '📈 Checking for more recipients');

    if (remaining > 0 && campaign.status === 'sending') {
      logger.info({ campaignId, remaining }, '⏭️ Scheduling next batch');
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
    logger.error({ 
      err: error, 
      campaignId,
      errorMessage: error.message,
      errorStack: error.stack
    }, '❌ Campaign processing error');
    
    try {
      const campaign = await Campaign.findById(campaignId);
      if (campaign) {
        campaign.status = 'failed';
        await campaign.save();
        logger.error({ 
          campaignId: campaign._id, 
          campaignName: campaign.name 
        }, '❌ Campaign marked as failed');
      }
    } catch (saveError) {
      logger.error({ 
        err: saveError,
        campaignId
      }, '❌ Failed to mark campaign as failed');
    }
  }
};

module.exports = {
  processCampaign
};
