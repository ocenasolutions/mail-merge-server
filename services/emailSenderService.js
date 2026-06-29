const { RateLimiterMemory } = require('rate-limiter-flexible');
const Campaign = require('../models/Campaign');
const Recipient = require('../models/Recipient');
const EmailConfig = require('../models/EmailConfig');
const User = require('../models/User');
const { sendEmail, mergeTags } = require('./emailService');
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
      emailsPerMinute: user.settings.emailsPerMinute
    }, '👤 User details loaded');

    const rateLimiter = getRateLimiter(
      user._id.toString(),
      user.settings.emailsPerMinute
    );

    const recipients = await Recipient.find({
      campaignId: campaign._id,
      status: 'pending'
    }).limit(500); // Increased from 100 to 500 for faster processing

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

    // Process emails in parallel for better performance
    const emailPromises = recipients.map(async (recipient) => {
      try {
        logger.info({ 
          recipientEmail: recipient.email,
          trackingId: recipient.trackingId
        }, '📤 Processing recipient');

        // Rate limiting - only consume if needed
        try {
          await rateLimiter.consume(user._id.toString());
        } catch (rateLimitError) {
          // If rate limit hit, throw to retry later
          throw rateLimitError;
        }

        // Convert Map to plain object for merge tags
        const mergeData = recipient.mergeData instanceof Map 
          ? Object.fromEntries(recipient.mergeData)
          : recipient.mergeData;

        logger.info({ 
          recipientEmail: recipient.email,
          mergeDataKeys: Object.keys(mergeData || {})
        }, '🔄 Merge data prepared');

        const subject = mergeTags(campaign.subject, mergeData);
        let body = mergeTags(campaign.htmlBody || campaign.body, mergeData);
        if (campaign.useSignature !== false) {
          const selectedSignatureHtml = campaign.signatureHtml || '';
          const fallbackSignatureHtml = user.settings?.signature?.enabled && user.settings?.signature?.html
            ? user.settings.signature.html
            : '';
          const resolvedSignatureHtml = selectedSignatureHtml || fallbackSignatureHtml;

          if (resolvedSignatureHtml) {
            body = `${body}${resolvedSignatureHtml}`;
          }
        }

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
          recipient.trackingId,
          {
            trackingEnabled: campaign.trackingEnabled !== false,
            attachments: campaign.attachments || []
          }
        );

        logger.info({ 
          recipientEmail: recipient.email,
          success: result.success,
          error: result.error,
          providerError: result.providerError,
          providerStatus: result.statusCode
        }, result.success ? '✅ Email sent successfully' : '❌ Email send failed');

        if (result.success) {
          recipient.status = 'sent';
          recipient.sentAt = new Date();
          recipient.sentSubject = subject;
          campaign.stats.sent += 1;
          successCount++;
        } else {
          recipient.status = 'failed';
          recipient.error = result.providerError
            ? `${result.error}: ${JSON.stringify(result.providerError)}`
            : result.error;
          campaign.stats.failed += 1;
          failedCount++;
        }

        await recipient.save();
        processedCount++;
        
        return { success: result.success, recipient };
      } catch (error) {
        logger.error({ 
          err: error,
          recipientEmail: recipient.email,
          errorMessage: error.message,
          msBeforeNext: error.msBeforeNext
        }, '❌ Error processing recipient');

        if (error.msBeforeNext) {
          // Rate limit hit, will retry later
          throw error;
        } else {
          recipient.status = 'failed';
          recipient.error = error.message;
          campaign.stats.failed += 1;
          failedCount++;
          await recipient.save();
          processedCount++;
          
          return { success: false, recipient, error };
        }
      }
    });

    // Wait for all emails to be processed
    try {
      await Promise.all(emailPromises);
    } catch (rateLimitError) {
      // If rate limit hit during parallel processing
      if (rateLimitError.msBeforeNext) {
        logger.warn({ 
          msBeforeNext: rateLimitError.msBeforeNext,
          processedCount,
          successCount,
          failedCount
        }, '⏸️ Rate limit hit, scheduling retry');
        
        await campaign.save();
        setTimeout(() => processCampaign(campaignId), Math.max(1, rateLimitError.msBeforeNext));
        return;
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
      // Reduced delay from 100ms to 10ms for faster processing
      setTimeout(() => processCampaign(campaignId), 10);
    } else if (remaining === 0) {
      campaign.status = 'completed';
      campaign.completedAt = new Date();
      await campaign.save();
      
      logger.info({ 
        campaignId: campaign._id,
        campaignName: campaign.name,
        stats: campaign.stats
      }, '✅ Campaign completed');
      
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
