const express = require('express');
const OutreachLead = require('../models/OutreachLead');

const router = express.Router();

function getNormalizedEmail(req) {
  const raw = req.query.userEmail || req.headers['x-user-email'] || req.body?.userEmail || '';
  return typeof raw === 'string' ? raw.toLowerCase().trim() : '';
}

// @route   GET /api/outreach
// @desc    Get all outreached lead records for authenticated user
router.get('/outreach', async (req, res) => {
  try {
    const userEmail = getNormalizedEmail(req);
    const filterQuery = userEmail ? { userEmail } : {};

    const records = await OutreachLead.find(filterQuery)
      .sort({ createdAt: -1 })
      .limit(100);

    const formatted = records.map((r) => ({
      id: r._id.toString(),
      contactName: r.contactName,
      contactTitle: r.contactTitle,
      contactEmail: r.contactEmail,
      companyName: r.companyName,
      companyDomain: r.companyDomain,
      location: r.location,
      templateName: r.templateName,
      sentAt: r.sentAt || new Date(r.createdAt).toLocaleString(),
      status: r.status,
      leadObj: r.leadObj,
    }));

    return res.json({
      success: true,
      count: formatted.length,
      outreachRecords: formatted,
    });
  } catch (error) {
    console.error('Error fetching outreach records:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

const User = require('../models/User');
const EmailConfig = require('../models/EmailConfig');
const { sendEmail } = require('../services/emailService');
const crypto = require('crypto');

// @route   POST /api/outreach
// @desc    Save a new outreached lead record and optionally send real email
router.post('/outreach', async (req, res) => {
  try {
    const userEmail = getNormalizedEmail(req);
    if (!userEmail) {
      return res.status(400).json({ success: false, message: 'userEmail is required to save outreach record.' });
    }

    const {
      contactName,
      contactTitle,
      contactEmail,
      companyName,
      companyDomain,
      location,
      templateName,
      sentAt,
      status = 'sent',
      leadObj,
      sendRealEmail = false,
      subject: customSubject,
      body: customBody
    } = req.body;

    if (!contactEmail || !contactName) {
      return res.status(400).json({ success: false, message: 'contactName and contactEmail are required.' });
    }

    let emailSent = false;
    let trackingId = null;

    // Dispatch real email if sendRealEmail is requested or if status is sent and lead has customPitch
    if (sendRealEmail || req.body.dispatch) {
      try {
        let user = await User.findOne({ email: { $regex: new RegExp(`^${userEmail}$`, 'i') } });
        if (!user) {
          user = await User.findOne({ email: 'aditya2.ocena@gmail.com' })
            || await User.findOne({ googleAccessToken: { $exists: true, $ne: null } });
        }

        if (user) {
          const emailConfig = {
            _id: 'gmail',
            provider: 'gmail',
            config: { email: user.email }
          };

          const pitchSub = customSubject || leadObj?.customPitch?.subject || `Partnership inquiry with ${companyName || 'your team'}`;
          let pitchBody = customBody || leadObj?.customPitch?.body || `<p>Hi ${contactName},</p><p>We noticed ${companyName} and would love to explore potential synergies.</p><p>Best regards,<br/>${user.name || 'Outreach Team'}</p>`;

          if (!pitchBody.includes('<p>') && !pitchBody.includes('<div>')) {
            pitchBody = pitchBody.split('\n\n').map(p => `<p style="margin: 0 0 14px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; color: #1e293b; line-height: 1.6;">${p.replace(/\n/g, '<br/>')}</p>`).join('');
          }

          trackingId = crypto.randomUUID();
          const sendResult = await sendEmail(
            emailConfig,
            user,
            contactEmail,
            pitchSub,
            pitchBody,
            trackingId,
            { trackingEnabled: true }
          );

          if (sendResult && sendResult.success) {
            emailSent = true;
            console.log(`📧 Dispatched live email to ${contactEmail} (tracking: ${trackingId})`);
          }
        }
      } catch (sendErr) {
        console.warn('Real email dispatch notice:', sendErr.message);
      }
    }

    const doc = new OutreachLead({
      userEmail,
      contactName,
      contactTitle: contactTitle || '',
      contactEmail,
      companyName: companyName || '',
      companyDomain: companyDomain || '',
      location: location || '',
      templateName: templateName || 'Default Template',
      sentAt: sentAt || `${new Date().toLocaleDateString()} • ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      status,
      leadObj: leadObj || null,
    });

    await doc.save();
    console.log(`💾 Saved Outreach Lead Record to MongoDB: ${contactName} (${contactEmail})`);

    return res.status(201).json({
      success: true,
      emailSent,
      trackingId,
      record: {
        id: doc._id.toString(),
        contactName: doc.contactName,
        contactTitle: doc.contactTitle,
        contactEmail: doc.contactEmail,
        companyName: doc.companyName,
        companyDomain: doc.companyDomain,
        location: doc.location,
        templateName: doc.templateName,
        sentAt: doc.sentAt,
        status: doc.status,
        leadObj: doc.leadObj,
      },
    });
  } catch (error) {
    console.error('Error saving outreach record:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// @route   DELETE /api/outreach/:id
// @desc    Delete a specific outreach record
router.delete('/outreach/:id', async (req, res) => {
  try {
    const userEmail = getNormalizedEmail(req);
    const filter = { _id: req.params.id };
    if (userEmail) filter.userEmail = userEmail;

    const deleted = await OutreachLead.findOneAndDelete(filter);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Outreach record not found' });
    }

    return res.json({
      success: true,
      message: 'Outreach record deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting outreach record:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// @route   DELETE /api/outreach
// @desc    Clear all outreach history for authenticated user
router.delete('/outreach', async (req, res) => {
  try {
    const userEmail = getNormalizedEmail(req);
    if (!userEmail) {
      return res.status(400).json({ success: false, message: 'userEmail is required to clear outreach history.' });
    }

    await OutreachLead.deleteMany({ userEmail });

    return res.json({
      success: true,
      message: `Cleared all outreach history for ${userEmail}`,
    });
  } catch (error) {
    console.error('Error clearing outreach history:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
