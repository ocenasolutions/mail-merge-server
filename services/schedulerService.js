const cron = require('node-cron');
const Campaign = require('../models/Campaign');
const { processCampaign } = require('./emailSenderService');

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

console.log('Scheduler service started');
