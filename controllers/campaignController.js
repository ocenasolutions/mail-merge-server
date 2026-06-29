const Campaign = require('../models/Campaign');
const Recipient = require('../models/Recipient');
const EmailConfig = require('../models/EmailConfig');
const Tracking = require('../models/Tracking');
const User = require('../models/User');
const { mergeTags, sendEmail } = require('../services/emailService');
const { syncCampaignStats, syncAllCampaignStatsForUser } = require('../services/campaignStatsService');
const crypto = require('crypto');
const axios = require('axios');
const { syncUserReplyStats } = require('../services/replyTrackingService');
const campaignPipeline = require('../services/campaignPipeline/campaignPipelineService');
const logger = require('../utils/logger');

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
    const campaigns = await Campaign.find({ userId: req.user._id })
      .populate('emailConfigId', 'name provider email config.email')
      .sort('-createdAt');

    const campaignIds = campaigns.map((campaign) => campaign._id);
    const recipients = await Recipient.find({ campaignId: { $in: campaignIds } })
      .sort({ createdAt: 1 });
    const trackingDocs = await Tracking.find({ campaignId: { $in: campaignIds } })
      .select('campaignId recipientId openCount clickCount firstOpenedAt lastOpenedAt opens clicks');

    const recipientsByCampaign = new Map();
    const trackingByRecipient = new Map();
    const liveStatsByCampaign = new Map();

    for (const tracking of trackingDocs) {
      trackingByRecipient.set(String(tracking.recipientId), {
        openCount: tracking.openCount || 0,
        clickCount: tracking.clickCount || 0,
        firstOpenedAt: tracking.firstOpenedAt || null,
        lastOpenedAt: tracking.lastOpenedAt || null,
        opens: Array.isArray(tracking.opens) ? tracking.opens.map((open) => ({
          timestamp: open.timestamp || null,
          userAgent: open.userAgent || '',
          ip: open.ip || ''
        })) : [],
        clicks: Array.isArray(tracking.clicks) ? tracking.clicks.map((click) => ({
          url: click.url || '',
          timestamp: click.timestamp || null,
          userAgent: click.userAgent || '',
          ip: click.ip || ''
        })) : []
      });

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
        status: recipient.status,
        error: recipient.error || null,
        tracking: trackingByRecipient.get(String(recipient._id)) || null
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
    await syncAllCampaignStatsForUser(req.user._id).catch(() => null);
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

    await syncCampaignStats(campaign).catch(() => null);
    await campaign.populate('emailConfigId');

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
    let existingAttachments = [];
    if (req.body.attachments) {
      try {
        const raw = Array.isArray(req.body.attachments)
          ? req.body.attachments
          : JSON.parse(req.body.attachments);
        
        existingAttachments = (raw || []).map((att) => ({
          name: att.name,
          mimeType: att.mimeType || 'application/octet-stream',
          size: typeof att.size === 'number' ? att.size : (att.bytes || parseInt(String(att.size)) || 0),
          contentBase64: '',
          url: att.url
        }));
      } catch (err) {
        existingAttachments = [];
      }
    }

    const s3Service = require('../services/s3Service');
    const uploadedAttachments = Array.isArray(req.files) ? req.files : [];
    const processedUploadedAttachments = await Promise.all(
      uploadedAttachments.map(async (file) => {
        if (!s3Service.isConfigured()) {
          throw new Error('S3 storage is not configured. File attachments are disabled.');
        }
        const url = await s3Service.uploadToS3(file.buffer, file.originalname, file.mimetype || 'application/octet-stream');
        return {
          name: file.originalname,
          mimeType: file.mimetype || 'application/octet-stream',
          size: file.size || 0,
          contentBase64: '',
          url
        };
      })
    );

    const allAttachments = [
      ...existingAttachments,
      ...processedUploadedAttachments
    ];

    const blockedAttachment = allAttachments.find((file) => BLOCKED_ATTACHMENT_EXTENSIONS.has(getAttachmentExtension(file.name)));

    if (blockedAttachment) {
      return res.status(400).json({ success: false, message: `Attachment type not allowed: ${blockedAttachment.name}` });
    }

    const providerKey = resolvedEmailConfig?.provider || 'gmail';
    const providerLimit = PROVIDER_ATTACHMENT_LIMITS[providerKey] || PROVIDER_ATTACHMENT_LIMITS.smtp;
    const totalAttachmentBytes = allAttachments.reduce((sum, file) => sum + (file.size || 0), 0);

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
      attachments: allAttachments,
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
      // Deduplicate by email address case-insensitively to prevent E11000 duplicate key error
      const seenEmails = new Set();
      const uniqueRecipients = [];
      for (const r of finalRecipients) {
        if (!r.email) continue;
        const emailLower = String(r.email).trim().toLowerCase();
        if (!seenEmails.has(emailLower)) {
          seenEmails.add(emailLower);
          uniqueRecipients.push(r);
        }
      }

      const recipientDocs = uniqueRecipients.map((r) => ({
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
    logger.error({ err: error }, 'Create campaign error');
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

    if (req.body.attachments && Array.isArray(req.body.attachments)) {
      req.body.attachments = req.body.attachments.map((att) => ({
        name: att.name,
        mimeType: att.mimeType || 'application/octet-stream',
        size: typeof att.size === 'number' ? att.size : (att.bytes || parseInt(String(att.size)) || 0),
        contentBase64: '',
        url: att.url
      }));
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
    await require('../models/CampaignDispatchJob').deleteMany({ campaignId: campaign._id });

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
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).populate('emailConfigId');

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const recipientCount = await Recipient.countDocuments({ campaignId: campaign._id });
    if (recipientCount === 0) {
      return res.status(400).json({
        success: false,
        message: 'No recipients found for this campaign'
      });
    }

    if (campaign.status === 'sending') {
      return res.status(400).json({ success: false, message: 'Campaign already sending' });
    }

    if (req.body.scheduledAt) {
      const scheduledAt = new Date(req.body.scheduledAt);
      await Campaign.updateOne(
        { _id: campaign._id },
        {
          $set: {
            status: 'scheduled',
            scheduledAt,
            startedAt: null,
            completedAt: null,
            'queue.throttledUntil': null
          }
        }
      );
      const updatedCampaign = await Campaign.findById(campaign._id).populate('emailConfigId');
      return res.json({ success: true, data: updatedCampaign });
    }

    const startedCampaign = await campaignPipeline.startCampaign(campaign._id, { reset: false });
    res.json({ success: true, data: startedCampaign });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to send campaign' });
  }
};

exports.pauseCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const updatedCampaign = await campaignPipeline.pauseCampaign(campaign._id);
    res.json({ success: true, data: updatedCampaign });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.resumeCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const updatedCampaign = await campaignPipeline.resumeCampaign(campaign._id);
    res.json({ success: true, data: updatedCampaign });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.restartCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const updatedCampaign = await campaignPipeline.restartCampaign(campaign._id);
    res.json({ success: true, data: updatedCampaign });
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

    logger.info({
      provider: emailConfig.provider,
      from: emailConfig.config.email || user.email,
      to: testEmail,
      trackingId
    }, 'Sending campaign test email');

    const result = await sendEmail(
      emailConfig,
      user,
      testEmail,
      subject,
      body,
      trackingId
    );

    if (result.success) {
      logger.info({ provider: emailConfig.provider, trackingId }, 'Test email sent successfully');
      res.json({ 
        success: true, 
        message: 'Test email sent successfully',
        trackingId
      });
    } else {
      logger.warn({ provider: emailConfig.provider, trackingId, error: result.error }, 'Test email failed');
      res.status(500).json({ 
        success: false, 
        message: `Failed to send test email: ${result.error}` 
      });
    }
  } catch (error) {
    logger.error({ err: error }, 'Test email error');
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
        message: 'Cannot retry while campaign is sending. Pause it first.'
      });
    }

    const failedRecipients = await Recipient.find({
      campaignId: campaign._id,
      status: 'failed'
    });

    if (failedRecipients.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No failed recipients to retry' 
      });
    }

    const updatedCampaign = await campaignPipeline.retryRecipients(campaign._id);

    res.json({
      success: true,
      message: `Retrying ${failedRecipients.length} failed recipients`,
      data: {
        retriedCount: failedRecipients.length,
        campaign: updatedCampaign
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to retry campaign' 
    });
  }
};

exports.retrySelected = async (req, res) => {
  try {
    const { recipientIds } = req.body;

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
        message: 'Cannot retry while campaign is sending. Pause it first.'
      });
    }

    const updatedCampaign = await campaignPipeline.retryRecipients(campaign._id, recipientIds);

    res.json({
      success: true,
      message: `Retrying selected recipients`,
      data: {
        retriedCount: recipientIds.length,
        campaign: updatedCampaign
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to retry selected recipients' 
    });
  }
};

exports.retryOne = async (req, res) => {
  try {
    const { recipientId } = req.body;

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
        message: 'Cannot retry while campaign is sending. Pause it first.'
      });
    }

    const recipient = await Recipient.findOne({
      _id: recipientId,
      campaignId: campaign._id
    });

    if (!recipient) {
      return res.status(404).json({ 
        success: false, 
        message: 'Recipient not found' 
      });
    }

    if (recipient.status === 'sent') {
      return res.status(400).json({
        success: false,
        message: 'Sent recipients cannot be retried'
      });
    }

    const updatedCampaign = await campaignPipeline.retryRecipients(campaign._id, [recipient._id]);

    res.json({
      success: true,
      message: `Retrying ${recipient.email}`,
      data: {
        recipient,
        campaign: updatedCampaign
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to retry recipient' 
    });
  }
};

exports.getDeadLetters = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id });
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const deadLetters = await campaignPipeline.listDeadLettersForCampaign(campaign._id);
    res.json({ success: true, data: deadLetters });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.requeueDeadLetter = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id });
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const { deadLetterId } = req.params;
    const deadLetter = await campaignPipeline.requeueDeadLetter(deadLetterId, {
      requeuedBy: req.user._id,
      requeuedAt: new Date().toISOString()
    });

    res.json({ success: true, data: deadLetter });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.sendFollowUp = async (req, res) => {
  try {
    const { id, recipientId } = req.params;

    const campaign = await Campaign.findOne({ _id: id, userId: req.user._id });
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const recipient = await Recipient.findOne({ _id: recipientId, campaignId: campaign._id });
    if (!recipient) {
      return res.status(404).json({ success: false, message: 'Recipient not found' });
    }

    const emailConfig = await EmailConfig.findOne({ _id: campaign.emailConfigId, userId: req.user._id }) 
      || await EmailConfig.findOne({ userId: req.user._id, verified: true });

    if (!emailConfig) {
      return res.status(400).json({ success: false, message: 'No verified email sender account found' });
    }

    let subject = `Re: ${recipient.sentSubject || campaign.subject}`;
    let body = `<p>Hi ${recipient.mergeData?.get('name') || recipient.mergeData?.get('Name') || 'there'},</p>
<p>I wanted to quickly follow up on my last email. I know you're busy, but I'd love to hear your thoughts when you have a moment.</p>
<p>Best regards,</p>`;

    if (process.env.GROQ_API_KEY) {
      try {
        const axios = require('axios');
        const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
        const stopToken = '###END###';
        const responseShape = '{"subject":"...","body":"..."}';
        const recipientName = recipient.mergeData?.get('name') || recipient.mergeData?.get('Name') || 'there';
        const recipientCompany = recipient.mergeData?.get('company') || recipient.mergeData?.get('Company') || '';

        const systemPrompt = `You write a friendly follow-up email to a recipient who opened our initial email but has not replied yet.
Return a JSON object only.
The JSON must match exactly this shape: ${responseShape}.
Never include markdown fences, explanations, notes, or commentary.
Keep the draft concise, polished, and natural.
Use recipient details: Name: ${recipientName}, Company: ${recipientCompany}.
The initial email subject was: "${recipient.sentSubject || campaign.subject}".
Make the subject line start with "Re: " or be relevant to the original.
End the response with ${stopToken}`;

        const userPrompt = `Write a short follow-up email to ${recipientName} at ${recipientCompany}. The original subject was "${recipient.sentSubject || campaign.subject}". Keep it clean and short, requesting a quick reply. Return only JSON then append ${stopToken}.`;

        const response = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            model,
            temperature: 0.5,
            max_completion_tokens: 500,
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
            },
            timeout: 8000
          }
        );

        const rawContent = response.data?.choices?.[0]?.message?.content?.trim();
        if (rawContent) {
          const cleanedContent = rawContent
            .replace(stopToken, '')
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();
          
          const parsed = JSON.parse(cleanedContent);
          if (parsed.subject) subject = parsed.subject;
          if (parsed.body) body = parsed.body;
        }
      } catch (err) {
        logger.error({ err }, 'Failed generating AI follow-up; falling back to template');
      }
    }

    const result = await sendEmail(
      emailConfig,
      req.user,
      recipient.email,
      subject,
      body,
      recipient.trackingId,
      {
        trackingEnabled: campaign.trackingEnabled !== false,
        attachments: campaign.attachments || []
      }
    );

    if (!result.success) {
      return res.status(500).json({ success: false, message: result.error || 'Failed to send follow-up email' });
    }

    recipient.followUpStatus = 'sent';
    recipient.followUpSentAt = new Date();
    await recipient.save();

    res.json({ success: true, message: 'Follow-up sent successfully', data: recipient });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
