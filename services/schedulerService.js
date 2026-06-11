const cron = require('node-cron');
const Campaign = require('../models/Campaign');
const User = require('../models/User');
const { processCampaign } = require('./emailSenderService');
const { syncUserReplyStats } = require('./replyTrackingService');
const { syncAllCampaignStatsForUser } = require('./campaignStatsService');

// Check for scheduled campaigns every minute
cron.schedule('* * * * *', async () => {
  try {
    const now = new Date();
    
    const campaigns = await Campaign.find({
      status: 'scheduled',
      scheduledAt: { $lte: now }
    });

    for (const campaign of campaigns) {
      campaign.status = 'sending';
      campaign.startedAt = new Date();
      await campaign.save();

      processCampaign(campaign._id);
    }
  } catch (error) {
    console.error('Scheduler error:', error);
  }
});

// Sync replies and campaign stats for all active users every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  try {
    console.log('⏳ Running scheduled background campaign stats & replies sync...');
    const users = await User.find({});
    for (const user of users) {
      await syncUserReplyStats(user._id).catch(err => 
        console.error(`Error syncing replies for user ${user._id}:`, err.message)
      );
      await syncAllCampaignStatsForUser(user._id).catch(err => 
        console.error(`Error syncing campaign stats for user ${user._id}:`, err.message)
      );
    }
    console.log('✅ Background stats & replies sync completed.');
  } catch (error) {
    console.error('Background stats sync scheduler error:', error);
  }
});

console.log('Scheduler service started');
