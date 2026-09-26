const express = require('express');
const router = express.Router();
const AutoGtmCampaign = require('../models/AutoGtmCampaign');
const logger = require('../utils/logger');

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
      dailyCap: c.dailyCap || '25'
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
      dailyCap: campData.dailyCap || '25'
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
