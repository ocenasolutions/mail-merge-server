const Tracking = require('../models/Tracking');
const Recipient = require('../models/Recipient');
const Campaign = require('../models/Campaign');
const TrackedEmail = require('../models/TrackedEmail');
const logger = require('../utils/logger');

const pixel = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

const sendPixel = (res) => {
  res.writeHead(200, {
    'Content-Type': 'image/gif',
    'Content-Length': pixel.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  return res.end(pixel);
};

const isObviousBot = (userAgent = '') => /bot|crawler|spider|headless|prerender|scanner|curl|wget/i.test(userAgent);

const resolveTrackedTarget = async (trackingId) => {
  const recipient = await Recipient.findOne({ trackingId });
  if (recipient) {
    let tracking = await Tracking.findOne({ recipientId: recipient._id });
    if (!tracking) {
      tracking = await Tracking.create({
        recipientId: recipient._id,
        campaignId: recipient.campaignId,
        opens: [],
        clicks: [],
        openCount: 0,
        clickCount: 0
      });
    }

    return {
      type: 'campaign',
      email: recipient.email,
      recipient,
      tracking
    };
  }

  const trackedEmail = await TrackedEmail.findOne({ trackingId });
  if (trackedEmail) {
    return {
      type: 'single',
      email: trackedEmail.recipientEmail,
      trackedEmail
    };
  }

  return null;
};

exports.trackOpen = async (req, res) => {
  try {
    const { trackingId } = req.params;
    const userAgent = req.headers['user-agent'] || '';
    const ip = req.ip;

    logger.info({
      trackingId,
      userAgent,
      ip,
      referer: req.headers['referer']
    }, '📧 Tracking pixel request received');

    if (isObviousBot(userAgent)) {
      logger.info({ trackingId, userAgent, reason: 'obvious bot detected' }, '⚠️ Ignoring bot request');
      return sendPixel(res);
    }

    const target = await resolveTrackedTarget(trackingId);
    if (!target) {
      logger.warn({ trackingId }, '❌ No tracked target found for trackingId');
      return res.status(404).send('Not found');
    }

    const now = new Date();

    if (target.type === 'campaign') {
      target.tracking.opens.push({
        timestamp: now,
        userAgent,
        ip
      });
      target.tracking.openCount += 1;
      if (!target.tracking.firstOpenedAt) {
        target.tracking.firstOpenedAt = now;
      }
      target.tracking.lastOpenedAt = now;
      await target.tracking.save();

      const campaign = await Campaign.findById(target.recipient.campaignId);
      if (campaign && target.tracking.openCount === 1) {
        campaign.stats.opened += 1;
        await campaign.save();
      }
    } else {
      target.trackedEmail.openCount += 1;
      if (!target.trackedEmail.firstOpenedAt) {
        target.trackedEmail.firstOpenedAt = now;
      }
      target.trackedEmail.lastOpenedAt = now;
      await target.trackedEmail.save();
    }

    const accept = req.headers['accept'] || '';
    const wantsHtml = accept.includes('text/html');
    const wantsImage = accept.includes('image/') || accept.includes('*/*');

    if (wantsHtml) {
      const openCount = target.type === 'campaign' ? target.tracking.openCount : target.trackedEmail.openCount;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Email Opened</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
            .container { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); max-width: 500px; margin: 0 auto; }
            h1 { color: #16a34a; }
            p { color: #666; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Tracking Confirmed</h1>
            <p>This email was tracked as opened.</p>
            <p style="font-size: 14px; color: #999; margin-top: 30px;">
              Email: ${target.email}<br>
              Opened: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}<br>
              Total Opens: ${openCount}
            </p>
          </div>
        </body>
        </html>
      `);
    }

    if (wantsImage || !userAgent.includes('curl')) {
      return sendPixel(res);
    }

    return sendPixel(res);
  } catch (error) {
    logger.error({ err: error, trackingId: req.params.trackingId }, 'Tracking error');
    return res.status(500).send('Error');
  }
};

exports.trackClick = async (req, res) => {
  try {
    const { trackingId } = req.params;
    const targetUrl = req.query.url;

    if (!targetUrl) {
      return res.status(400).send('Missing target URL');
    }

    const target = await resolveTrackedTarget(trackingId);
    if (!target) {
      return res.redirect(targetUrl);
    }

    const now = new Date();
    const clickEvent = {
      url: targetUrl,
      timestamp: now,
      userAgent: req.headers['user-agent'] || '',
      ip: req.ip
    };

    if (target.type === 'campaign') {
      target.tracking.clicks.push(clickEvent);
      target.tracking.clickCount += 1;
      await target.tracking.save();

      const campaign = await Campaign.findById(target.recipient.campaignId);
      if (campaign && target.tracking.clickCount === 1) {
        campaign.stats.clicked += 1;
        await campaign.save();
      }
    } else {
      target.trackedEmail.clicks.push(clickEvent);
      target.trackedEmail.clickCount += 1;
      await target.trackedEmail.save();
    }

    return res.redirect(targetUrl);
  } catch (error) {
    logger.error({ err: error, trackingId: req.params.trackingId }, 'Click tracking error');
    return res.status(500).send('Error');
  }
};

exports.sendgridWebhook = async (req, res) => {
  try {
    const events = req.body;

    for (const event of events) {
      const { email, event: eventType } = event;

      if (eventType === 'bounce' || eventType === 'dropped') {
        const recipient = await Recipient.findOne({ email });
        if (recipient) {
          recipient.status = 'bounced';
          await recipient.save();

          const campaign = await Campaign.findById(recipient.campaignId);
          if (campaign) {
            campaign.stats.bounced += 1;
            await campaign.save();
          }
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('SendGrid webhook error:', error);
    res.status(500).json({ success: false });
  }
};

exports.mailgunWebhook = async (req, res) => {
  try {
    const { event, recipient } = req.body;

    if (event === 'bounced' || event === 'failed') {
      const recipientDoc = await Recipient.findOne({ email: recipient });
      if (recipientDoc) {
        recipientDoc.status = 'bounced';
        await recipientDoc.save();

        const campaign = await Campaign.findById(recipientDoc.campaignId);
        if (campaign) {
          campaign.stats.bounced += 1;
          await campaign.save();
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Mailgun webhook error:', error);
    res.status(500).json({ success: false });
  }
};
