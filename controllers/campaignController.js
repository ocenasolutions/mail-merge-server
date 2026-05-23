const Campaign = require('../models/Campaign');
const Recipient = require('../models/Recipient');
const EmailConfig = require('../models/EmailConfig');
const Tracking = require('../models/Tracking');
const User = require('../models/User');
const { mergeTags, sendEmail } = require('../services/emailService');
const crypto = require('crypto');
const axios = require('axios');
const { syncUserReplyStats } = require('../services/replyTrackingService');

const BLOCKED_ATTACHMENT_EXTENSIONS = new Set(['ade', 'adp', 'apk', 'appx', 'bat', 'cab', 'chm', 'cmd', 'com', 'cpl', 'diagcab', 'dll', 'dmg', 'exe', 'hta', 'ins', 'isp', 'iso', 'jar', 'js', 'jse', 'lib', 'lnk', 'mde', 'msc', 'msi', 'msp', 'mst', 'nsh', 'pif', 'ps1', 'reg', 'scr', 'sct', 'sh', 'sys', 'vb', 'vbe', 'vbs', 'vxd', 'wsc', 'wsf', 'wsh']);
const PROVIDER_ATTACHMENT_LIMITS = {
  gmail: 25 * 1024 * 1024,
  outlook: 25 * 1024 * 1024,
  hostinger: 25 * 1024 * 1024,
  smtp: 25 * 1024 * 1024,
  custom: 25 * 1024 * 1024,
  brevo: 20 * 1024 * 1024,
  sendgrid: 30 * 1024 * 1024,
  mailgun: 25 * 1024 * 1024,
  godaddy: 30 * 1024 * 1024,
  titan: 25 * 1024 * 1024
};

const getAttachmentExtension = (filename = '') => filename.split('.').pop()?.toLowerCase() || '';

const resolveCampaignEmailConfig = async (userId) => {
  const preferredConfig = await EmailConfig.findOne({
    userId,
    verified: true
  }).sort({ isDefault: -1, updatedAt: -1, createdAt: -1 });

  if (preferredConfig) {
    return preferredConfig;
  }

  const fallbackConfig = await EmailConfig.findOne({ userId })
    .sort({ isDefault: -1, updatedAt: -1, createdAt: -1 });

  if (fallbackConfig) {
    return fallbackConfig;
  }

  const user = await User.findById(userId);
  if (!user?.googleAccessToken || !user?.email) {
    return null;
  }

  return EmailConfig.findOneAndUpdate(
    {
      userId,
      provider: 'gmail',
      $or: [
        { 'config.email': user.email },
        { email: user.email }
      ]
    },
    {
      $set: {
        name: 'Primary Gmail',
        provider: 'gmail',
        verified: true,
        isDefault: true,
        email: user.email,
        'config.email': user.email
      }
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    }
  );
};

exports.getCampaigns = async (req, res) => {
  try {
    await syncUserReplyStats(req.user._id).catch(() => null);

    const campaigns = await Campaign.find({ userId: req.user._id })
      .populate('emailConfigId', 'name provider email config.email')
      .sort('-createdAt');

    const campaignIds = campaigns.map((campaign) => campaign._id);
    const recipients = await Recipient.find({ campaignId: { $in: campaignIds } })
      .sort({ createdAt: 1 });
    const trackingDocs = await Tracking.find({ campaignId: { $in: campaignIds } })
      .select('campaignId openCount clickCount');

    const recipientsByCampaign = new Map();
    const liveStatsByCampaign = new Map();

    for (const tracking of trackingDocs) {
      const key = String(tracking.campaignId);
      const current = liveStatsByCampaign.get(key) || { opened: 0, clicked: 0, replied: 0 };

      if ((tracking.openCount || 0) > 0) {
        current.opened += 1;
      }

      if ((tracking.clickCount || 0) > 0) {
        current.clicked += 1;
      }

      liveStatsByCampaign.set(key, current);
    }

    for (const recipient of recipients) {
      const mergeData = recipient.mergeData instanceof Map
        ? Object.fromEntries(recipient.mergeData)
        : (recipient.mergeData || {});
      const key = String(recipient.campaignId);
      const existingRecipients = recipientsByCampaign.get(key) || [];

      existingRecipients.push({
        name: mergeData.name || recipient.email,
        company: mergeData.company || '',
        email: recipient.email,
        status: recipient.status
      });

      recipientsByCampaign.set(key, existingRecipients);

      const current = liveStatsByCampaign.get(key) || { opened: 0, clicked: 0, replied: 0 };
      if ((recipient.replyCount || 0) > 0) {
        current.replied += 1;
      }
      liveStatsByCampaign.set(key, current);
    }

    const data = campaigns.map((campaign) => {
      const campaignJson = campaign.toObject();
      const senderEmail = campaignJson.emailConfigId?.config?.email
        || campaignJson.emailConfigId?.email
        || null;
      const liveStats = liveStatsByCampaign.get(String(campaign._id)) || { opened: 0, clicked: 0, replied: 0 };

      return {
        ...campaignJson,
        stats: {
          ...campaignJson.stats,
          opened: liveStats.opened,
          clicked: liveStats.clicked,
          replied: liveStats.replied
        },
        senderEmail,
        recipients: recipientsByCampaign.get(String(campaign._id)) || [],
        attachments: (campaignJson.attachments || []).map((attachment) => ({
          name: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.size
        }))
      };
    });

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getStats = async (req, res) => {
  try {
    await syncUserReplyStats(req.user._id).catch(() => null);

    const campaigns = await Campaign.find({ userId: req.user._id });
    
    const totalCampaigns = campaigns.length;
    const activeCampaigns = campaigns.filter(c => c.status === 'sending').length;

    let totalSent = 0;
    let totalOpened = 0;
    let totalReplies = 0;
    
    for (const campaign of campaigns) {
      totalSent += campaign.stats.sent || 0;
      totalOpened += campaign.stats.opened || 0;
      totalReplies += campaign.stats.replied || 0;
    }
    
    const openRate = totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0;
    const replyRate = totalSent > 0 ? Math.round((totalReplies / totalSent) * 100) : 0;
    
    res.json({
      success: true,
      data: {
        totalCampaigns,
        activeCampaigns,
        totalSent,
        totalReplies,
        openRate,
        replyRate
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
    const { recipients, recipientSource = 'manual', ...campaignData } = req.body;
    const parsedRecipients = Array.isArray(recipients)
      ? recipients
      : typeof recipients === 'string' && recipients.trim()
        ? JSON.parse(recipients)
        : [];
    const resolvedEmailConfig = campaignData.emailConfigId
      ? await EmailConfig.findOne({ _id: campaignData.emailConfigId, userId: req.user._id })
      : await resolveCampaignEmailConfig(req.user._id);
    const uploadedAttachments = Array.isArray(req.files) ? req.files : [];
    const blockedAttachment = uploadedAttachments.find((file) => BLOCKED_ATTACHMENT_EXTENSIONS.has(getAttachmentExtension(file.originalname)));

    if (blockedAttachment) {
      return res.status(400).json({ success: false, message: `Attachment type not allowed: ${blockedAttachment.originalname}` });
    }

    const providerKey = resolvedEmailConfig?.provider || 'gmail';
    const providerLimit = PROVIDER_ATTACHMENT_LIMITS[providerKey] || PROVIDER_ATTACHMENT_LIMITS.smtp;
    const totalAttachmentBytes = uploadedAttachments.reduce((sum, file) => sum + (file.size || 0), 0);

    if (totalAttachmentBytes > providerLimit) {
      return res.status(400).json({
        success: false,
        message: `Attachments exceed the ${Math.round(providerLimit / (1024 * 1024))} MB limit for ${providerKey}.`
      });
    }
    
    // Create campaign
    const campaign = await Campaign.create({
      ...campaignData,
      recipientSource,
      emailConfigId: resolvedEmailConfig?._id,
      attachments: uploadedAttachments.map((file) => ({
        name: file.originalname,
        mimeType: file.mimetype || 'application/octet-stream',
        size: file.size || 0,
        contentBase64: file.buffer.toString('base64')
      })),
      userId: req.user._id,
      stats: {
        total: 0,
        sent: 0,
        failed: 0,
        opened: 0,
        bounced: 0,
        clicked: 0,
        replied: 0
      }
    });

    let finalRecipients = Array.isArray(parsedRecipients) ? parsedRecipients : [];

    if (finalRecipients && finalRecipients.length > 0) {
      const recipientDocs = finalRecipients.map((r) => ({
        mergeData: {
          ...(r.mergeData || {}),
          name: r.name || r.mergeData?.name || '',
          company: r.company || r.mergeData?.company || '',
          email: r.email
        },
        campaignId: campaign._id,
        email: r.email,
        trackingId: crypto.randomUUID(),
        status: 'pending'
      }));

      await Recipient.insertMany(recipientDocs);
      
      campaign.stats.total = recipientDocs.length;
      await campaign.save();
    }

    res.status(201).json({ success: true, data: campaign });
  } catch (error) {
    console.error('Create campaign error:', error);
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
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const { rowIndex = 0 } = req.body;

    const savedRecipient = await Recipient.findOne({
      campaignId: campaign._id
    }).sort({ createdAt: 1 });

    const row = savedRecipient
      ? (savedRecipient.mergeData instanceof Map
          ? Object.fromEntries(savedRecipient.mergeData)
          : savedRecipient.mergeData)
      : null;

    if (!row) {
      return res.status(400).json({ success: false, message: 'No recipient data available for preview' });
    }

    const mergedSubject = mergeTags(campaign.subject, row);
    const mergedBody = mergeTags(campaign.body, row);

    res.json({
      success: true,
      data: {
        email: row.email,
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
    }).populate('emailConfigId');

    if (!campaign) {
      console.log('❌ Campaign not found:', req.params.id);
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    console.log('✅ Campaign found:', {
      id: campaign._id,
      name: campaign.name,
      status: campaign.status,
      hasEmailConfig: !!campaign.emailConfigId
    });

    if (campaign.status === 'sending') {
      console.log('⚠️ Campaign already sending');
      return res.status(400).json({ success: false, message: 'Campaign already sending' });
    }

    if (!campaign.emailConfigId) {
      const resolvedEmailConfig = await resolveCampaignEmailConfig(req.user._id);

      if (!resolvedEmailConfig) {
        console.log('❌ Email configuration not found for campaign');
        return res.status(400).json({ success: false, message: 'Email configuration not found for this campaign' });
      }

      campaign.emailConfigId = resolvedEmailConfig._id;
      await campaign.save();
      await campaign.populate('emailConfigId');
    }

    let pendingRecipients = await Recipient.find({
      campaignId: campaign._id,
      status: 'pending'
    });

    if (pendingRecipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No recipients found for this campaign'
      });
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
            lastOpenedAt: tracking.lastOpenedAt,
            clickCount: tracking.clickCount,
            clicks: tracking.clicks || []
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
    res.status(410).json({
      success: false,
      message: 'Google Sheet updates are no longer supported for campaigns'
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

exports.generateAiDraft = async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(400).json({ success: false, message: 'GROQ_API_KEY is not configured on the server' });
    }

    const {
      prompt = '',
      purpose = '',
      audience = '',
      tone = 'professional',
      cta = '',
      signature = 'Thanks,\nYour Team',
      format = 'html',
      existingContent = ''
    } = req.body || {};

    const normalizedPrompt = String(prompt || '').trim();
    const normalizedPurpose = String(purpose || '').trim();
    const normalizedExistingContent = String(existingContent || '').trim();
    const normalizedFormat = format === 'text' ? 'text' : 'html';

    if (!normalizedPrompt && !normalizedPurpose && !normalizedExistingContent) {
      return res.status(400).json({ success: false, message: 'Provide a prompt, purpose, or existingContent' });
    }

    const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    const stopToken = '###END###';
    const wantsRewrite = Boolean(normalizedExistingContent);
    const responseShape = '{"subject":"...","body":"..."}';
    const systemPrompt = [
      'You write outbound emails and email templates for business users.',
      normalizedFormat === 'html'
        ? 'Return body as valid email HTML using only <p>, <strong>, <em>, <ul>, <li>, <a>, and <br>.'
        : 'Return body as plain text only. Do not include HTML.',
      'Return a JSON object only.',
      `The JSON must match exactly this shape: ${responseShape}.`,
      'Never include markdown fences, explanations, notes, or commentary.',
      'Keep the draft concise, polished, and usable.',
      'Use merge tags exactly as provided, especially {{name}} and {{company}} when relevant.',
      'Do not invent unsupported merge tags.',
      'The subject should be natural and specific, not generic.',
      `End the response with ${stopToken}`
    ].join(' ');

    const userPrompt = [
      normalizedPrompt ? `Prompt: ${normalizedPrompt}` : null,
      normalizedPurpose ? `Purpose: ${normalizedPurpose}` : null,
      `Audience: ${audience || 'General business recipient'}`,
      `Tone: ${tone}`,
      `Call to action: ${cta || 'Ask for a short reply or meeting.'}`,
      `Signature:\n${signature}`,
      wantsRewrite
        ? `Existing content to improve or rewrite:\n${normalizedExistingContent}`
        : null,
      wantsRewrite
        ? 'Rewrite the existing email while preserving the core intent and make it cleaner and more effective.'
        : 'Write a complete new email that starts with a greeting to {{name}} and is appropriate for mail merge.',
      normalizedFormat === 'html'
        ? 'The body should be production-ready email HTML.'
        : 'The body should be plain text suitable for direct sending.',
      `Return only the JSON object with subject and body, then append ${stopToken} at the very end.`
    ].filter(Boolean).join('\n');

    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model,
        temperature: 0.4,
        max_completion_tokens: 700,
        stop: [stopToken],
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const rawContent = response.data?.choices?.[0]?.message?.content?.trim();

    if (!rawContent) {
      return res.status(500).json({ success: false, message: 'Groq returned an empty draft' });
    }

    const cleanedContent = rawContent
      .replace(stopToken, '')
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed;

    try {
      parsed = JSON.parse(cleanedContent);
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Groq returned an invalid AI draft response'
      });
    }

    const subject = String(parsed?.subject || normalizedPurpose || normalizedPrompt || 'New email').trim();
    const body = String(parsed?.body || '').trim();

    if (!body) {
      return res.status(500).json({ success: false, message: 'Groq returned an empty draft body' });
    }

    res.json({
      success: true,
      data: {
        model,
        subject,
        body,
        format: normalizedFormat
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.response?.data?.error?.message || error.message || 'Failed to generate AI draft'
    });
  }
};

exports.retryFailed = async (req, res) => {
  try {
    console.log('🔄 Retry failed recipients request for campaign:', req.params.id);
    
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).populate('emailConfigId');

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
