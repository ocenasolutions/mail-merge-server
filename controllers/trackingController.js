const Tracking = require('../models/Tracking');
const Recipient = require('../models/Recipient');
const Campaign = require('../models/Campaign');
const logger = require('../utils/logger');

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

    // Filter out automated/bot requests
    const isBot = /bot|crawler|spider|headless|prerender|proxy|prefetch|scanner/i.test(userAgent);
    const isGoogleProxy = /google/i.test(userAgent) || ip.includes('66.102') || ip.includes('66.249');
    const isEmailProxy = /yahoo|outlook|microsoft|apple|icloud/i.test(userAgent);
    
    if (isBot || isGoogleProxy || isEmailProxy) {
      logger.info({ trackingId, userAgent, reason: 'bot/proxy detected' }, '⚠️ Ignoring automated request');
      
      // Still send pixel but don't count it
      const pixel = Buffer.from(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        'base64'
      );
      res.writeHead(200, {
        'Content-Type': 'image/gif',
        'Content-Length': pixel.length,
        'Cache-Control': 'no-store, no-cache, must-revalidate, private'
      });
      return res.end(pixel);
    }

    const recipient = await Recipient.findOne({ trackingId });
    if (!recipient) {
      logger.warn({ trackingId }, '❌ Recipient not found for trackingId');
      return res.status(404).send('Not found');
    }
    
    logger.info({ email: recipient.email, trackingId }, '✅ Recipient found');

    let tracking = await Tracking.findOne({ recipientId: recipient._id });

    if (!tracking) {
      tracking = await Tracking.create({
        recipientId: recipient._id,
        campaignId: recipient.campaignId,
        opens: [],
        clicks: []
      });
    }

    const now = new Date();
    tracking.opens.push({
      timestamp: now,
      userAgent: req.headers['user-agent'],
      ip: req.ip
    });
    tracking.openCount += 1;

    if (!tracking.firstOpenedAt) {
      tracking.firstOpenedAt = now;
    }
    tracking.lastOpenedAt = now;

    await tracking.save();
    
    logger.info({
      email: recipient.email,
      openCount: tracking.openCount,
      firstOpenedAt: tracking.firstOpenedAt,
      lastOpenedAt: tracking.lastOpenedAt
    }, '✅ Tracking updated');

    // Update campaign stats
    const campaign = await Campaign.findById(recipient.campaignId);
    if (campaign && tracking.openCount === 1) {
      campaign.stats.opened += 1;
      await campaign.save();
      logger.info({ 
        campaignId: campaign._id, 
        campaignName: campaign.name,
        openedCount: campaign.stats.opened 
      }, '✅ Campaign stats updated');
    }

    // Send 1x1 transparent pixel
    const pixel = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64'
    );

    // If accessed from browser (not as image), show a message
    const accept = req.headers['accept'] || '';
    const isImageRequest = accept.includes('image/') || accept.includes('*/*');
    
    if (!isImageRequest && !userAgent.includes('curl') && !accept.includes('text/html')) {
      // Likely an email client loading the pixel - send GIF
      res.writeHead(200, {
        'Content-Type': 'image/gif',
        'Content-Length': pixel.length,
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(pixel);
    } else if (accept.includes('text/html')) {
      // Browser request - show HTML page
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Email Opened</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
            .container { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); max-width: 500px; margin: 0 auto; }
            h1 { color: #4CAF50; }
            p { color: #666; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✓ Email Tracking Confirmed</h1>
            <p>This email has been successfully tracked and marked as opened.</p>
            <p style="font-size: 14px; color: #999; margin-top: 30px;">
              Email: ${recipient.email}<br>
              Opened: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}<br>
              Total Opens: ${tracking.openCount}
            </p>
          </div>
        </body>
        </html>
      `);
    } else {
      // Image request - send pixel
      res.writeHead(200, {
        'Content-Type': 'image/gif',
        'Content-Length': pixel.length,
        'Cache-Control': 'no-store, no-cache, must-revalidate, private'
      });
      res.end(pixel);
    }
  } catch (error) {
    logger.error({ err: error, trackingId: req.params.trackingId }, 'Tracking error');
    res.status(500).send('Error');
  }
};

exports.sendgridWebhook = async (req, res) => {
  try {
    const events = req.body;

    for (const event of events) {
      const { email, event: eventType, sg_message_id } = event;

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
