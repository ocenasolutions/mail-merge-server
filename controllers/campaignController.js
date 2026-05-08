const Campaign = require('../models/Campaign');
const Recipient = require('../models/Recipient');
const Sheet = require('../models/Sheet');
const User = require('../models/User');
const { getSheetData } = require('../services/googleSheetsService');
const { mergeTags, sendEmail } = require('../services/emailService');
const crypto = require('crypto');

exports.getCampaigns = async (req, res) => {
  try {
    const campaigns = await Campaign.find({ userId: req.user._id })
      .populate('sheetId', 'name')
      .populate('emailConfigId', 'name provider')
      .sort('-createdAt');

    res.json({ success: true, data: campaigns });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getStats = async (req, res) => {
  try {
    const campaigns = await Campaign.find({ userId: req.user._id });
    
    const totalCampaigns = campaigns.length;
    const activeCampaigns = campaigns.filter(c => c.status === 'sending').length;
    
    let totalSent = 0;
    let totalOpened = 0;
    
    for (const campaign of campaigns) {
      totalSent += campaign.stats.sent || 0;
      totalOpened += campaign.stats.opened || 0;
    }
    
    const openRate = totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0;
    
    res.json({
      success: true,
      data: {
        totalCampaigns,
        activeCampaigns,
        totalSent,
        openRate
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      userId: req.user._id
    })
      .populate('sheetId')
      .populate('emailConfigId');

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    res.json({ success: true, data: campaign });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.create({
      ...req.body,
      userId: req.user._id
    });

    res.status(201).json({ success: true, data: campaign });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    if (campaign.status === 'sending') {
      return res.status(400).json({ success: false, message: 'Cannot update campaign while sending' });
    }

    Object.assign(campaign, req.body);
    await campaign.save();

    res.json({ success: true, data: campaign });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.deleteCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    // Delete associated recipients
    await Recipient.deleteMany({ campaignId: campaign._id });

    res.json({ success: true, message: 'Campaign deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.previewCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).populate('sheetId');

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const user = await User.findById(req.user._id);
    const sheetData = await getSheetData(
      campaign.sheetId.sheetId,
      user.googleAccessToken,
      user.googleRefreshToken
    );

    const { rowIndex = 0 } = req.body;
    const row = sheetData.rows[rowIndex];

    if (!row) {
      return res.status(400).json({ success: false, message: 'Invalid row index' });
    }

    const mergedSubject = mergeTags(campaign.subject, row);
    const mergedBody = mergeTags(campaign.body, row);

    res.json({
      success: true,
      data: {
        email: row[campaign.emailColumn],
        subject: mergedSubject,
        body: mergedBody,
        mergeData: row
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.sendCampaign = async (req, res) => {
  try {
    console.log('📧 Send campaign request received for campaign:', req.params.id);
    
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).populate('sheetId emailConfigId');

    if (!campaign) {
      console.log('❌ Campaign not found:', req.params.id);
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    console.log('✅ Campaign found:', {
      id: campaign._id,
      name: campaign.name,
      status: campaign.status,
      hasSheet: !!campaign.sheetId,
      hasEmailConfig: !!campaign.emailConfigId
    });

    if (campaign.status === 'sending') {
      console.log('⚠️ Campaign already sending');
      return res.status(400).json({ success: false, message: 'Campaign already sending' });
    }

    if (!campaign.sheetId) {
      console.log('❌ Sheet not found for campaign');
      return res.status(400).json({ success: false, message: 'Sheet not found for this campaign' });
    }

    if (!campaign.emailConfigId) {
      console.log('❌ Email configuration not found for campaign');
      return res.status(400).json({ success: false, message: 'Email configuration not found for this campaign' });
    }

    const user = await User.findById(req.user._id);
    
    console.log('👤 User details:', {
      id: user._id,
      email: user.email,
      hasGoogleAccessToken: !!user.googleAccessToken,
      hasGoogleRefreshToken: !!user.googleRefreshToken
    });

    if (!user.googleAccessToken) {
      console.log('❌ Google authentication required');
      return res.status(400).json({ success: false, message: 'Google authentication required. Please log out and log in again.' });
    }

    console.log('📊 Fetching sheet data from Google Sheets...');
    const sheetData = await getSheetData(
      campaign.sheetId.sheetId,
      user.googleAccessToken,
      user.googleRefreshToken
    );

    console.log('✅ Sheet data fetched:', {
      rowCount: sheetData.rows.length,
      headers: sheetData.headers
    });

    // Create recipients
    const recipients = [];
    let skippedCount = 0;
    
    for (const row of sheetData.rows) {
      const email = row[campaign.emailColumn];
      if (!email) {
        skippedCount++;
        continue;
      }

      const existing = await Recipient.findOne({
        campaignId: campaign._id,
        email
      });

      if (!existing) {
        recipients.push({
          campaignId: campaign._id,
          email,
          mergeData: row,
          trackingId: crypto.randomUUID()
        });
      }
    }

    console.log('📋 Recipients prepared:', {
      newRecipients: recipients.length,
      skippedEmptyEmails: skippedCount
    });

    if (recipients.length > 0) {
      await Recipient.insertMany(recipients);
      console.log('✅ Recipients inserted into database');
    }

    campaign.stats.total = await Recipient.countDocuments({ campaignId: campaign._id });
    campaign.status = req.body.scheduledAt ? 'scheduled' : 'sending';
    campaign.scheduledAt = req.body.scheduledAt;
    campaign.startedAt = req.body.scheduledAt ? null : new Date();
    await campaign.save();

    console.log('✅ Campaign updated:', {
      status: campaign.status,
      totalRecipients: campaign.stats.total,
      scheduled: !!req.body.scheduledAt
    });

    // Start sending if not scheduled
    if (!req.body.scheduledAt) {
      console.log('🚀 Starting email sending process...');
      require('../services/emailSenderService').processCampaign(campaign._id);
    }

    res.json({ success: true, data: campaign });
  } catch (error) {
    console.error('❌ Send campaign error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: error.message || 'Failed to send campaign' });
  }
};

exports.pauseCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { status: 'paused' },
      { new: true }
    );

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    res.json({ success: true, data: campaign });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.resumeCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    campaign.status = 'sending';
    await campaign.save();

    require('../services/emailSenderService').processCampaign(campaign._id);

    res.json({ success: true, data: campaign });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getRecipients = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const recipients = await Recipient.find({ campaignId: campaign._id })
      .sort('-createdAt')
      .limit(1000);

    // Get tracking data for each recipient
    const recipientsWithTracking = await Promise.all(
      recipients.map(async (recipient) => {
        const tracking = await require('../models/Tracking').findOne({ 
          recipientId: recipient._id 
        });
        
        return {
          ...recipient.toObject(),
          tracking: tracking ? {
            openCount: tracking.openCount,
            firstOpenedAt: tracking.firstOpenedAt,
            lastOpenedAt: tracking.lastOpenedAt
          } : null
        };
      })
    );

    // Disable caching for real-time tracking updates
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    res.json({ success: true, data: recipientsWithTracking });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateSheet = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).populate('sheetId');

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const user = await User.findById(req.user._id);
    const { updateSheetWithStatus } = require('../services/googleSheetsService');
    const Tracking = require('../models/Tracking');

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

    const result = await updateSheetWithStatus(
      campaign.sheetId.sheetId,
      user.googleAccessToken,
      user.googleRefreshToken,
      campaign.emailColumn,
      statusData
    );

    res.json({ 
      success: true, 
      message: `Updated ${result.updatedRows} rows in Google Sheet`,
      data: result
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.testEmail = async (req, res) => {
  try {
    const { emailConfigId, testEmail } = req.body;
    
    if (!emailConfigId || !testEmail) {
      return res.status(400).json({ 
        success: false, 
        message: 'emailConfigId and testEmail are required' 
      });
    }

    const EmailConfig = require('../models/EmailConfig');
    const emailConfig = await EmailConfig.findOne({
      _id: emailConfigId,
      userId: req.user._id
    });

    if (!emailConfig) {
      return res.status(404).json({ success: false, message: 'Email configuration not found' });
    }

    const user = await User.findById(req.user._id);
    const { sendEmail } = require('../services/emailService');
    const crypto = require('crypto');

    const trackingId = crypto.randomUUID();
    const subject = 'Test Email from Mail Merge';
    const body = `
      <html>
        <body>
          <h2>Test Email</h2>
          <p>This is a test email from your Mail Merge application.</p>
          <p>If you received this email, your email configuration is working correctly!</p>
          <p><strong>Provider:</strong> ${emailConfig.provider}</p>
          <p><strong>From:</strong> ${emailConfig.config.email || user.email}</p>
          <p><strong>Sent at:</strong> ${new Date().toLocaleString()}</p>
        </body>
      </html>
    `;

    console.log('🧪 Sending test email:', {
      provider: emailConfig.provider,
      from: emailConfig.config.email || user.email,
      to: testEmail,
      trackingId
    });

    const result = await sendEmail(
      emailConfig,
      user,
      testEmail,
      subject,
      body,
      trackingId
    );

    if (result.success) {
      console.log('✅ Test email sent successfully');
      res.json({ 
        success: true, 
        message: 'Test email sent successfully',
        trackingId
      });
    } else {
      console.log('❌ Test email failed:', result.error);
      res.status(500).json({ 
        success: false, 
        message: `Failed to send test email: ${result.error}` 
      });
    }
  } catch (error) {
    console.error('❌ Test email error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.retryFailed = async (req, res) => {
  try {
    console.log('🔄 Retry failed recipients request for campaign:', req.params.id);
    
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).populate('sheetId emailConfigId');

    if (!campaign) {
      console.log('❌ Campaign not found:', req.params.id);
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    console.log('✅ Campaign found:', {
      id: campaign._id,
      name: campaign.name,
      status: campaign.status
    });

    // Check if campaign is in a state that allows retry
    if (campaign.status === 'sending') {
      console.log('⚠️ Campaign is currently sending');
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot retry while campaign is sending. Please pause it first.' 
      });
    }

    if (!campaign.emailConfigId) {
      console.log('❌ Email configuration not found for campaign');
      return res.status(400).json({ 
        success: false, 
        message: 'Email configuration not found for this campaign' 
      });
    }

    // Find all failed recipients
    const failedRecipients = await Recipient.find({
      campaignId: campaign._id,
      status: 'failed'
    });

    console.log('📋 Failed recipients found:', failedRecipients.length);

    if (failedRecipients.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No failed recipients to retry' 
      });
    }

    // Reset failed recipients to pending
    await Recipient.updateMany(
      {
        campaignId: campaign._id,
        status: 'failed'
      },
      {
        $set: { 
          status: 'pending',
          error: null,
          sentAt: null
        }
      }
    );

    // Update campaign stats
    campaign.stats.failed = 0;
    campaign.status = 'sending';
    campaign.startedAt = new Date();
    await campaign.save();

    console.log('✅ Failed recipients reset to pending:', failedRecipients.length);
    console.log('🚀 Starting retry process...');

    // Start sending
    require('../services/emailSenderService').processCampaign(campaign._id);

    res.json({ 
      success: true, 
      message: `Retrying ${failedRecipients.length} failed recipients`,
      data: {
        retriedCount: failedRecipients.length,
        campaign
      }
    });
  } catch (error) {
    console.error('❌ Retry failed error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to retry campaign' 
    });
  }
};

exports.retrySelected = async (req, res) => {
  try {
    const { recipientIds } = req.body;
    console.log('🔄 Retry selected recipients request:', recipientIds?.length);

    if (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'recipientIds array is required' 
      });
    }

    const campaign = await Campaign.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).populate('emailConfigId');

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    if (campaign.status === 'sending') {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot retry while campaign is sending. Please pause it first.' 
      });
    }

    // Reset selected recipients to pending
    const result = await Recipient.updateMany(
      {
        _id: { $in: recipientIds },
        campaignId: campaign._id,
        status: 'failed'
      },
      {
        $set: { 
          status: 'pending',
          error: null,
          sentAt: null
        }
      }
    );

    console.log('✅ Selected recipients reset to pending:', result.modifiedCount);

    // Update campaign stats
    const failedCount = await Recipient.countDocuments({
      campaignId: campaign._id,
      status: 'failed'
    });
    campaign.stats.failed = failedCount;
    campaign.status = 'sending';
    await campaign.save();

    // Start sending
    require('../services/emailSenderService').processCampaign(campaign._id);

    res.json({ 
      success: true, 
      message: `Retrying ${result.modifiedCount} selected recipients`,
      data: {
        retriedCount: result.modifiedCount
      }
    });
  } catch (error) {
    console.error('❌ Retry selected error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to retry selected recipients' 
    });
  }
};

exports.retryOne = async (req, res) => {
  try {
    const { recipientId } = req.body;
    console.log('🔄 Retry one recipient request:', recipientId);

    if (!recipientId) {
      return res.status(400).json({ 
        success: false, 
        message: 'recipientId is required' 
      });
    }

    const campaign = await Campaign.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).populate('emailConfigId');

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    if (campaign.status === 'sending') {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot retry while campaign is sending. Please pause it first.' 
      });
    }

    // Find and reset the recipient
    const recipient = await Recipient.findOne({
      _id: recipientId,
      campaignId: campaign._id,
      status: 'failed'
    });

    if (!recipient) {
      return res.status(404).json({ 
        success: false, 
        message: 'Failed recipient not found' 
      });
    }

    recipient.status = 'pending';
    recipient.error = null;
    recipient.sentAt = null;
    await recipient.save();

    console.log('✅ Recipient reset to pending:', recipient.email);

    // Update campaign stats
    const failedCount = await Recipient.countDocuments({
      campaignId: campaign._id,
      status: 'failed'
    });
    campaign.stats.failed = failedCount;
    campaign.status = 'sending';
    await campaign.save();

    // Start sending
    require('../services/emailSenderService').processCampaign(campaign._id);

    res.json({ 
      success: true, 
      message: `Retrying ${recipient.email}`,
      data: {
        recipient
      }
    });
  } catch (error) {
    console.error('❌ Retry one error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to retry recipient' 
    });
  }
};
