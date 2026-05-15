const express = require('express');
const router = express.Router();
const trackingController = require('../controllers/trackingController');

// Webhook endpoints (no auth required)
router.post('/webhook/sendgrid', trackingController.sendgridWebhook);
router.post('/webhook/mailgun', trackingController.mailgunWebhook);
router.get('/click/:trackingId', trackingController.trackClick);

module.exports = router;
