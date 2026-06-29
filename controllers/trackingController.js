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

// NOTE: This deduplication cache is intentionally process-local. 
// If the application is deployed with multiple Node.js instances, workers, or scaled horizontally, 
// replace this in-memory Map implementation with a shared Redis client.
const recentHitsCache = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of recentHitsCache.entries()) {
    if (now - value > 30000) {
      recentHitsCache.delete(key);
    }
  }
}, 30000);

const resolveTrackedTarget = async (trackingId) => {
  const recipient = await Recipient.findOne({ trackingId }).lean();
  if (recipient) {
    return {
      type: 'campaign',
      email: recipient.email,
      recipientId: recipient._id,
      campaignId: recipient.campaignId,
      sentAt: recipient.sentAt
    };
  }

  const trackedEmail = await TrackedEmail.findOne({ trackingId }).lean();
  if (trackedEmail) {
    return {
      type: 'single',
      email: trackedEmail.recipientEmail,
      trackedEmailId: trackedEmail._id,
      firstOpenedAt: trackedEmail.firstOpenedAt,
      openCount: trackedEmail.openCount,
      clickCount: trackedEmail.clickCount
    };
  }

  return null;
};

exports.trackOpen = async (req, res) => {
  try {
    const { trackingId } = req.params;
    const userAgent = req.headers['user-agent'] || '';
    const ip = req.ip;

    const accept = req.headers['accept'] || '';
    const wantsHtml = accept.includes('text/html');

    // Deduplication check: check cache synchronously BEFORE scheduling background tasks
    const nowMs = Date.now();
    const lastHit = recentHitsCache.get(trackingId);
    if (lastHit && (nowMs - lastHit < 15000)) {
      if (wantsHtml) {
        // Proceed for HTML debug view
      } else {
        return sendPixel(res);
      }
    }

    if (!wantsHtml && !isObviousBot(userAgent)) {
      recentHitsCache.set(trackingId, nowMs);
    }

    // If debugging via browser directly requesting HTML, resolve synchronously
    if (wantsHtml) {
      const target = await resolveTrackedTarget(trackingId);
      if (!target) {
        return res.status(404).send('Not found');
      }
      let openCount = 0;
      if (target.type === 'campaign') {
        const tracking = await Tracking.findOne({ recipientId: target.recipientId }).lean();
        openCount = tracking ? tracking.openCount : 0;
      } else {
        openCount = target.openCount || 0;
      }
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

    // For standard tracking pixels, respond to the client immediately (< 5ms latency)
    sendPixel(res);

    // Process the DB record update asynchronously in the background
    setImmediate(async () => {
      try {
        if (isObviousBot(userAgent)) {
          return;
        }

        const target = await resolveTrackedTarget(trackingId);
        if (!target) {
          return;
        }

        const now = new Date();

        // Basic security bot filter: if opened within 2 seconds of sending, ignore the tracking hit
        if (target.type === 'campaign' && target.sentAt) {
          const msSinceSent = now.getTime() - new Date(target.sentAt).getTime();
          if (msSinceSent < 2000) {
            return;
          }
        }

        if (target.type === 'campaign') {
          // Atomically insert the Tracking record ONLY if it doesn't already exist.
          // By using $setOnInsert, we do not perform any write updates on subsequent opens.
          const trackingDoc = await Tracking.findOneAndUpdate(
            { recipientId: target.recipientId },
            {
              $setOnInsert: {
                recipientId: target.recipientId,
                campaignId: target.campaignId,
                openCount: 1,
                firstOpenedAt: now,
                lastOpenedAt: now,
                opens: [{
                  timestamp: now,
                  userAgent,
                  ip
                }]
              }
            },
            { upsert: true, new: false, lean: true } // new: false returns the old document state
          );

          // If trackingDoc is null, it means the document was just created (first open)
          if (!trackingDoc) {
            await Campaign.updateOne(
              { _id: target.campaignId },
              { $inc: { 'stats.opened': 1 } }
            );
          }
        } else {
          // Single email: only update if openCount is currently 0
          const trackedEmailDoc = await TrackedEmail.findOneAndUpdate(
            { _id: target.trackedEmailId, openCount: 0 },
            {
              $set: {
                openCount: 1,
                firstOpenedAt: now,
                lastOpenedAt: now
              }
            },
            { new: false, lean: true }
          );
        }
      } catch (backgroundError) {
        logger.error({ err: backgroundError, trackingId }, 'Background tracking pixel write error');
      }
    });

  } catch (error) {
    logger.error({ err: error, trackingId: req.params.trackingId }, 'Tracking error');
    if (!res.headersSent) {
      sendPixel(res);
    }
  }
};

exports.trackClick = async (req, res) => {
  try {
    const { trackingId } = req.params;
    let targetUrl = req.query.url;

    if (!targetUrl) {
      return res.status(400).send('Missing target URL');
    }

    // Proactive recovery fallback for placeholder/broken redirects (e.g. href="https://")
    if (targetUrl === 'https://' || targetUrl === 'http://' || targetUrl === 'https' || targetUrl === 'http') {
      try {
        const target = await resolveTrackedTarget(trackingId);
        if (target && target.type === 'campaign') {
          const campaign = await Campaign.findById(target.campaignId).lean();
          if (campaign) {
            const content = campaign.htmlBody || campaign.body || '';
            const urlRegex = /https?:\/\/[^\s"'<>\(\)]+/gi;
            let match;
            while ((match = urlRegex.exec(content)) !== null) {
              const foundUrl = match[0];
              if (foundUrl.length > 10 && !foundUrl.includes('tracking') && !foundUrl.includes('mail-merge-server')) {
                targetUrl = foundUrl;
                break;
              }
            }
          }
        }
      } catch (err) {
        logger.error({ err, trackingId }, 'Error resolving recovery redirect URL');
      }
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
      // Register click atomically and check previous openCount
      const trackingDoc = await Tracking.findOneAndUpdate(
        { recipientId: target.recipientId },
        {
          $push: { clicks: clickEvent },
          $inc: { clickCount: 1 }
        },
        { upsert: true, new: false, lean: true } // return old state (before update)
      );

      let clickInitiatedOpen = false;
      if (!trackingDoc || trackingDoc.openCount === 0) {
        // If it was never opened, atomically register an open too
        await Tracking.updateOne(
          { recipientId: target.recipientId },
          {
            $push: {
              opens: {
                timestamp: now,
                userAgent: req.headers['user-agent'] || '',
                ip: req.ip
              }
            },
            $inc: { openCount: 1 },
            $set: {
              lastOpenedAt: now
            },
            $setOnInsert: {
              campaignId: target.campaignId,
              firstOpenedAt: now
            }
          },
          { upsert: true }
        );
        clickInitiatedOpen = true;
      }

      // Update campaign stats atomically
      const incFields = {};
      if (!trackingDoc || trackingDoc.clickCount === 0) {
        incFields['stats.clicked'] = 1;
      }
      if (clickInitiatedOpen) {
        incFields['stats.opened'] = 1;
      }

      if (Object.keys(incFields).length > 0) {
        await Campaign.updateOne(
          { _id: target.campaignId },
          { $inc: incFields }
        );
      }
    } else {
      // Single email click atomic registration
      const trackedEmailDoc = await TrackedEmail.findOneAndUpdate(
        { _id: target.trackedEmailId },
        {
          $push: { clicks: clickEvent },
          $inc: { clickCount: 1 }
        },
        { new: false, lean: true }
      );

      if (trackedEmailDoc && trackedEmailDoc.openCount === 0) {
        await TrackedEmail.updateOne(
          { _id: target.trackedEmailId },
          {
            $inc: { openCount: 1 },
            $set: {
              firstOpenedAt: now,
              lastOpenedAt: now
            }
          }
        );
      }
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
        const recipient = await Recipient.findOneAndUpdate(
          { email },
          { $set: { status: 'bounced' } },
          { new: false, lean: true }
        );

        if (recipient && recipient.status !== 'bounced') {
          await Campaign.updateOne(
            { _id: recipient.campaignId },
            { $inc: { 'stats.bounced': 1 } }
          );
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'SendGrid webhook error');
    res.status(500).json({ success: false });
  }
};

exports.mailgunWebhook = async (req, res) => {
  try {
    const { event, recipient } = req.body;

    if (event === 'bounced' || event === 'failed') {
      const recipientDoc = await Recipient.findOneAndUpdate(
        { email: recipient },
        { $set: { status: 'bounced' } },
        { new: false, lean: true }
      );

      if (recipientDoc && recipientDoc.status !== 'bounced') {
        await Campaign.updateOne(
          { _id: recipientDoc.campaignId },
          { $inc: { 'stats.bounced': 1 } }
        );
      }
    }

    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Mailgun webhook error');
    res.status(500).json({ success: false });
  }
};
