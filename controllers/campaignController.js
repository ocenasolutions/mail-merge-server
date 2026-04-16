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
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).populate('sheetId emailConfigId');

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    if (campaign.status === 'sending') {
      return res.status(400).json({ success: false, message: 'Campaign already sending' });
    }

    if (!campaign.sheetId) {
      return res.status(400).json({ success: false, message: 'Sheet not found for this campaign' });
    }

    if (!campaign.emailConfigId) {
      return res.status(400).json({ success: false, message: 'Email configuration not found for this campaign' });
    }

    const user = await User.findById(req.user._id);
    
    if (!user.googleAccessToken) {
      return res.status(400).json({ success: false, message: 'Google authentication required. Please log out and log in again.' });
    }

    const sheetData = await getSheetData(
      campaign.sheetId.sheetId,
      user.googleAccessToken,
      user.googleRefreshToken
    );

    // Create recipients
    const recipients = [];
    for (const row of sheetData.rows) {
      const email = row[campaign.emailColumn];
      if (!email) continue;

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

    if (recipients.length > 0) {
      await Recipient.insertMany(recipients);
    }

    campaign.stats.total = await Recipient.countDocuments({ campaignId: campaign._id });
    campaign.status = req.body.scheduledAt ? 'scheduled' : 'sending';
    campaign.scheduledAt = req.body.scheduledAt;
    campaign.startedAt = req.body.scheduledAt ? null : new Date();
    await campaign.save();

    // Start sending if not scheduled
    if (!req.body.scheduledAt) {
      require('../services/emailSenderService').processCampaign(campaign._id);
    }

    res.json({ success: true, data: campaign });
  } catch (error) {
    console.error('Send campaign error:', error);
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
