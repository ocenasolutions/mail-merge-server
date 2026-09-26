const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const AutoGtmCampaign = require('../models/AutoGtmCampaign');
const User = require('../models/User');
const EmailConfig = require('../models/EmailConfig');
const TrackedEmail = require('../models/TrackedEmail');
const { sendEmail } = require('../services/emailService');
const logger = require('../utils/logger');

/**
 * Helper to resolve sender User & EmailConfig
 */
async function resolveSender(userEmailParam, accountId) {
  const normalizedEmail = (userEmailParam || '').trim().toLowerCase();
  let user = null;

  if (normalizedEmail) {
    user = await User.findOne({ email: { $regex: new RegExp(`^${normalizedEmail}$`, 'i') } });
  }

  // If no user found by email, fallback to first user with valid Google token or aditya2.ocena
  if (!user) {
    user = await User.findOne({ email: 'aditya2.ocena@gmail.com' })
      || await User.findOne({ googleAccessToken: { $exists: true, $ne: null } });
  }

  let emailConfig = null;
  if (accountId && accountId !== 'gmail') {
    emailConfig = await EmailConfig.findOne({ _id: accountId });
  } else if (user) {
    emailConfig = await EmailConfig.findOne({ userId: user._id, isDefault: true })
      || await EmailConfig.findOne({ userId: user._id });
  }

  if (!emailConfig) {
    emailConfig = {
      _id: 'gmail',
      provider: 'gmail',
      config: { email: user?.email || normalizedEmail || 'aditya2.ocena@gmail.com' }
    };
  }

  return { user, emailConfig };
}

// GET /api/autogtm/campaigns
router.get('/campaigns', async (req, res) => {
  try {
    const userEmail = (req.headers['x-user-email'] || req.query.userEmail || '').trim().toLowerCase();
    const query = userEmail ? { userEmail } : {};
    const campaigns = await AutoGtmCampaign.find(query).sort({ updatedAt: -1 }).lean();
    
    // Map to frontend format
    const formatted = campaigns.map(c => ({
      id: c.campaignId || c._id.toString(),
      _id: c._id,
      name: c.name,
      status: c.status,
      stage: c.stage,
      statusReason: c.statusReason,
      targetUrl: c.targetUrl,
      leadsCount: c.leadsCount,
      offer: c.offer,
      customerProblem: c.customerProblem,
      targetRole: c.targetRole,
      exampleClients: c.exampleClients || [],
      keywords: c.keywords || [],
      steerLogs: c.steerLogs || [],
      leads: c.leads || [],
      template: c.template || { subject: '', body: '' },
      sequence: c.sequence || [],
      sent: c.sent || 0,
      openedCount: c.openedCount || 0,
      repliedCount: c.repliedCount || 0,
      openRate: c.openRate || '0%',
      replyRate: c.replyRate || '0%',
      interested: c.interested || 0,
      spent: c.spent || '$0.00',
      dailyCap: c.dailyCap || '25',
      targetingCriteria: c.targetingCriteria || {
        employeeCounts: ['1-10 (Seed)', '11-50 (Startup)', '51-200 (Mid-Market)'],
        companyStages: ['Startup / Early-Stage', 'Bootstrapped & Profitable', 'VC-Backed Scaleup'],
        revenueRanges: ['$50,000 - $250,000 ARR', '$250,000 - $1M ARR', '$1M - $10M ARR'],
        countries: ['United States', 'United Kingdom', 'India'],
        industries: ['B2B SaaS & Tech', 'IT Services & Software'],
        decisionMakerRole: 'Founder & CEO, VP of Engineering, CTO',
        seniorityLevels: ['Founders & C-Suite', 'VP / Head of Dept'],
        growthSignals: ['🚀 Actively Hiring', '⚡ Fast Growth'],
        minRevenue: '$50,000+'
      }
    }));

    res.json({
      success: true,
      campaigns: formatted
    });
  } catch (err) {
    logger.error({ err }, '[AutoGTM] Failed to fetch campaigns');
    res.status(500).json({ success: false, message: 'Failed to fetch campaigns', error: err.message });
  }
});

// POST /api/autogtm/campaigns
router.post('/campaigns', async (req, res) => {
  try {
    const userEmail = (req.body.userEmail || req.headers['x-user-email'] || req.query.userEmail || '').trim().toLowerCase() || 'default@ocena.in';
    const campData = req.body.campaign || req.body;
    const campaignId = campData.id || `camp_${Date.now()}`;

    const updateDoc = {
      campaignId,
      userEmail,
      name: campData.name || 'AI Outreach Campaign',
      status: campData.status || 'Active',
      stage: campData.stage || 'Prospecting',
      statusReason: campData.statusReason || '',
      targetUrl: campData.targetUrl || '',
      leadsCount: typeof campData.leadsCount === 'number' ? campData.leadsCount : (campData.leads ? campData.leads.length : 0),
      offer: campData.offer || '',
      customerProblem: campData.customerProblem || '',
      targetRole: campData.targetRole || 'Founder & CEO, VP of Engineering, CTO',
      exampleClients: Array.isArray(campData.exampleClients) ? campData.exampleClients : [],
      keywords: Array.isArray(campData.keywords) ? campData.keywords : [],
      steerLogs: Array.isArray(campData.steerLogs) ? campData.steerLogs : [],
      leads: Array.isArray(campData.leads) ? campData.leads : [],
      template: campData.template || { subject: '', body: '' },
      sequence: Array.isArray(campData.sequence) ? campData.sequence : [],
      sent: typeof campData.sent === 'number' ? campData.sent : 0,
      openedCount: typeof campData.openedCount === 'number' ? campData.openedCount : 0,
      repliedCount: typeof campData.repliedCount === 'number' ? campData.repliedCount : 0,
      openRate: campData.openRate || '0%',
      replyRate: campData.replyRate || '0%',
      interested: typeof campData.interested === 'number' ? campData.interested : 0,
      spent: campData.spent || '$0.00',
      dailyCap: campData.dailyCap || '25',
      targetingCriteria: campData.targetingCriteria || {
        employeeCounts: ['1-10 (Seed)', '11-50 (Startup)', '51-200 (Mid-Market)'],
        companyStages: ['Startup / Early-Stage', 'Bootstrapped & Profitable', 'VC-Backed Scaleup'],
        revenueRanges: ['$50,000 - $250,000 ARR', '$250,000 - $1M ARR', '$1M - $10M ARR'],
        countries: ['United States', 'United Kingdom', 'India'],
        industries: ['B2B SaaS & Tech', 'IT Services & Software'],
        decisionMakerRole: 'Founder & CEO, VP of Engineering, CTO',
        seniorityLevels: ['Founders & C-Suite', 'VP / Head of Dept'],
        growthSignals: ['🚀 Actively Hiring', '⚡ Fast Growth'],
        minRevenue: '$50,000+'
      }
    };

    const saved = await AutoGtmCampaign.findOneAndUpdate(
      { userEmail, campaignId },
      { $set: updateDoc },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({
      success: true,
      campaign: {
        ...updateDoc,
        id: campaignId,
        _id: saved._id
      }
    });
  } catch (err) {
    logger.error({ err }, '[AutoGTM] Failed to save campaign');
    res.status(500).json({ success: false, message: 'Failed to save campaign', error: err.message });
  }
});

// PUT /api/autogtm/campaigns/:id
router.put('/campaigns/:id', async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userEmail = (req.body.userEmail || req.headers['x-user-email'] || req.query.userEmail || '').trim().toLowerCase();
    const campData = req.body.campaign || req.body;

    const query = userEmail ? { userEmail, campaignId } : { campaignId };
    const saved = await AutoGtmCampaign.findOneAndUpdate(
      query,
      { $set: campData },
      { new: true }
    );

    res.json({
      success: true,
      campaign: saved
    });
  } catch (err) {
    logger.error({ err }, '[AutoGTM] Failed to update campaign');
    res.status(500).json({ success: false, message: 'Failed to update campaign', error: err.message });
  }
});

// POST /api/autogtm/campaigns/:id/test-send AND POST /api/autogtm/test-send
// Sends a real live test email to verify campaign template & tracking delivery
async function handleTestSend(req, res) {
  try {
    const rawUserEmail = req.body.userEmail || req.headers['x-user-email'] || req.query.userEmail || '';
    const testRecipient = (req.body.testEmail || req.body.recipientEmail || rawUserEmail || 'aditya2.ocena@gmail.com').trim();
    const campaignId = req.params.id || req.body.campaignId;
    const accountId = req.body.accountId;

    if (!testRecipient) {
      return res.status(400).json({ success: false, message: 'testEmail is required for test dispatch' });
    }

    const { user, emailConfig } = await resolveSender(rawUserEmail, accountId);

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'No active Google OAuth or sender account found. Please sign in with Google.'
      });
    }

    // Determine subject and body from campaign or body
    let subject = req.body.subject;
    let body = req.body.body;

    if (!subject || !body) {
      if (campaignId) {
        const campaign = await AutoGtmCampaign.findOne({ campaignId }).lean();
        if (campaign) {
          subject = subject || campaign.template?.subject || `Partnership inquiry with ${campaign.name}`;
          body = body || campaign.template?.body || `<p>Hi there,</p><p>This is a test outreach email for campaign <strong>${campaign.name}</strong>.</p><p>Best regards,<br/>${user.name || 'Outreach Team'}</p>`;
        }
      }
    }

    subject = subject || '🚀 Auto-GTM Campaign Test Outreach';
    body = body || `<p>Hi Aditya,</p><p>This is a live test email from your <strong>Auto-GTM Campaign Engine</strong>. Real email dispatch and tracking are fully active.</p><p>Best regards,<br/>${user.name || 'Outreach Team'}</p>`;

    // Replace merge tags with sample values
    const sampleMerge = {
      name: user.name?.split(' ')[0] || 'Aditya',
      first_name: user.name?.split(' ')[0] || 'Aditya',
      company: 'Ocena Solutions',
      location: 'Mohali, Punjab, India',
      industry: 'B2B SaaS & AI Software',
      role: 'Founder & CEO'
    };

    let processedSubject = subject;
    let processedBody = body;
    for (const [k, v] of Object.entries(sampleMerge)) {
      const reg = new RegExp(`\\{\\{${k}\\}\\}|\\{${k}\\}`, 'gi');
      processedSubject = processedSubject.replace(reg, v);
      processedBody = processedBody.replace(reg, v);
    }

    // Convert plain newlines to paragraphs if not rich HTML
    if (!processedBody.includes('<p>') && !processedBody.includes('<div>')) {
      processedBody = processedBody.split('\n\n').map(p => `<p style="margin: 0 0 14px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; color: #1e293b; line-height: 1.6;">${p.replace(/\n/g, '<br/>')}</p>`).join('');
    }

    // Add visual test badge in email
    const fullHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
        <div style="display: inline-block; background: #fee2e2; color: #b91c1c; font-size: 11px; font-weight: bold; padding: 4px 10px; border-radius: 9999px; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.05em;">
          ⚡ Live Auto-GTM Test Dispatch
        </div>
        <div>
          ${processedBody}
        </div>
        <div style="margin-top: 28px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8;">
          Sent via <strong>${emailConfig.provider.toUpperCase()}</strong> (${emailConfig.config?.email || user.email}) • EmailDrop Live Campaign Verification
        </div>
      </div>
    `;

    const trackingId = crypto.randomUUID();
    logger.info({
      from: emailConfig.config?.email || user.email,
      to: testRecipient,
      provider: emailConfig.provider,
      trackingId
    }, '[AutoGTM] Dispatching live test email');

    const result = await sendEmail(
      emailConfig,
      user,
      testRecipient,
      processedSubject,
      fullHtml,
      trackingId,
      { trackingEnabled: true }
    );

    if (result.success) {
      return res.json({
        success: true,
        message: `Live test email successfully sent to ${testRecipient}!`,
        trackingId,
        provider: emailConfig.provider,
        sender: emailConfig.config?.email || user.email,
        recipient: testRecipient,
        subject: processedSubject
      });
    } else {
      return res.status(500).json({
        success: false,
        message: `Email dispatch failed: ${result.error || 'Provider rejected request'}`,
        providerError: result.providerError
      });
    }
  } catch (err) {
    logger.error({ err }, '[AutoGTM] Test send error');
    return res.status(500).json({ success: false, message: err.message });
  }
}

router.post('/campaigns/:id/test-send', handleTestSend);
router.post('/test-send', handleTestSend);

// POST /api/autogtm/campaigns/:id/send-lead
// Dispatches an email to a single lead from campaign, updates status in Mongo
router.post('/campaigns/:id/send-lead', async (req, res) => {
  try {
    const campaignId = req.params.id;
    const rawUserEmail = req.body.userEmail || req.headers['x-user-email'] || req.query.userEmail || '';
    const { leadId, customPitch, accountId } = req.body;

    const campaign = await AutoGtmCampaign.findOne({ campaignId });
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const leadIndex = (campaign.leads || []).findIndex(l => (l.id === leadId || l._id?.toString() === leadId));
    if (leadIndex === -1) {
      return res.status(404).json({ success: false, message: 'Lead not found in campaign' });
    }

    const lead = campaign.leads[leadIndex];
    const recipientEmail = lead.email;
    if (!recipientEmail) {
      return res.status(400).json({ success: false, message: 'Lead does not have a valid email address' });
    }

    const { user, emailConfig } = await resolveSender(rawUserEmail, accountId);
    if (!user) {
      return res.status(400).json({ success: false, message: 'No authenticated sender account found.' });
    }

    const subject = customPitch?.subject || lead.customPitch?.subject || campaign.template?.subject || `Partnership inquiry with ${lead.company}`;
    let body = customPitch?.body || lead.customPitch?.body || campaign.template?.body || `Hi ${lead.name},\n\nI noticed ${lead.company} operating in ${lead.location}. We help B2B enterprises automate outreach.\n\nBest regards,\n${user.name || 'Ocena Team'}`;

    // Merge tags
    const leadMerge = {
      name: lead.name || 'there',
      first_name: lead.name?.split(' ')[0] || 'there',
      company: lead.company || 'your team',
      location: lead.location || 'your region',
      industry: lead.industry || 'your industry',
      role: lead.title || 'Leader'
    };

    let processedSubject = subject;
    let processedBody = body;
    for (const [k, v] of Object.entries(leadMerge)) {
      const reg = new RegExp(`\\{\\{${k}\\}\\}|\\{${k}\\}`, 'gi');
      processedSubject = processedSubject.replace(reg, v);
      processedBody = processedBody.replace(reg, v);
    }

    if (!processedBody.includes('<p>') && !processedBody.includes('<div>')) {
      processedBody = processedBody.split('\n\n').map(p => `<p style="margin: 0 0 14px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; color: #1e293b; line-height: 1.6;">${p.replace(/\n/g, '<br/>')}</p>`).join('');
    }

    const trackingId = crypto.randomUUID();
    const result = await sendEmail(
      emailConfig,
      user,
      recipientEmail,
      processedSubject,
      processedBody,
      trackingId,
      { trackingEnabled: true }
    );

    const sentTime = `${new Date().toLocaleDateString()} • ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    // Update lead in campaign
    lead.status = 'sent';
    lead.outreachStatus = 'sent';
    lead.sentAt = sentTime;
    lead.customPitch = { subject: processedSubject, body: processedBody };
    lead.trackingId = trackingId;
    campaign.leads[leadIndex] = lead;
    campaign.sent = (campaign.sent || 0) + 1;
    campaign.markModified('leads');
    await campaign.save();

    res.json({
      success: true,
      message: `Email sent to ${lead.name} (${recipientEmail})`,
      trackingId,
      sentAt: sentTime,
      lead
    });
  } catch (err) {
    logger.error({ err }, '[AutoGTM] Send lead error');
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/autogtm/campaigns/:id
router.delete('/campaigns/:id', async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userEmail = (req.headers['x-user-email'] || req.query.userEmail || '').trim().toLowerCase();
    const query = userEmail ? { userEmail, campaignId } : { campaignId };

    await AutoGtmCampaign.deleteMany(query);
    res.json({ success: true, message: `Campaign ${campaignId} deleted` });
  } catch (err) {
    logger.error({ err }, '[AutoGTM] Failed to delete campaign');
    res.status(500).json({ success: false, message: 'Failed to delete campaign', error: err.message });
  }
});

// DELETE /api/autogtm/campaigns (clear all)
router.delete('/campaigns', async (req, res) => {
  try {
    const userEmail = (req.headers['x-user-email'] || req.query.userEmail || '').trim().toLowerCase();
    const query = userEmail ? { userEmail } : {};

    await AutoGtmCampaign.deleteMany(query);
    res.json({ success: true, message: 'All campaigns cleared' });
  } catch (err) {
    logger.error({ err }, '[AutoGTM] Failed to clear campaigns');
    res.status(500).json({ success: false, message: 'Failed to clear campaigns', error: err.message });
  }
});

module.exports = router;
