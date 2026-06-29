const cron = require('node-cron');
const User = require('../models/User');
const Campaign = require('../models/Campaign');
const logger = require('../utils/logger');
const { syncUserReplyStats } = require('./replyTrackingService');
const { syncAllCampaignStatsForUser } = require('./campaignStatsService');
const campaignPipeline = require('./campaignPipeline/campaignPipelineService');

const startedTasks = [];

campaignPipeline.start();

// Check for scheduled campaigns every minute.
startedTasks.push(
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const dueCampaigns = await Campaign.find({
        status: 'scheduled',
        scheduledAt: { $lte: now }
      }).select('_id');

      for (const campaign of dueCampaigns) {
        await campaignPipeline.startCampaign(campaign._id, {
          scheduledAt: campaign.scheduledAt,
          initiatedByScheduler: true
        });
      }
    } catch (error) {
      logger.error({ err: error }, 'Scheduler error while activating campaigns');
    }
  })
);

// Sync replies and campaign stats every 15 minutes — one user at a time via cursor.
let syncInProgress = false;

startedTasks.push(
  cron.schedule('*/15 * * * *', async () => {
    if (syncInProgress) {
      logger.warn('Background sync already in progress — skipping this tick');
      return;
    }

    syncInProgress = true;
    logger.info('Running scheduled background campaign stats & replies sync');

    try {
      // Use a cursor so we never hold all users in memory at once.
      const cursor = User.find({}).select('_id').lean().cursor();

      for await (const user of cursor) {
        await syncUserReplyStats(user._id).catch((err) =>
          logger.warn({ err, userId: user._id }, 'Error syncing replies')
        );

        await syncAllCampaignStatsForUser(user._id).catch((err) =>
          logger.warn({ err, userId: user._id }, 'Error syncing campaign stats')
        );

        // Yield to the event loop between users so GC can breathe.
        await new Promise((resolve) => setImmediate(resolve));
      }

      logger.info('Background stats & replies sync completed');
    } catch (error) {
      logger.error({ err: error }, 'Background stats sync scheduler error');
    } finally {
      syncInProgress = false;
    }
  })
);

logger.info({ taskCount: startedTasks.length }, 'Scheduler service started');

module.exports = {
  stopAll: () => {
    startedTasks.forEach((task) => task.stop());
  }
};