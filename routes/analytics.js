const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const analyticsController = require('../controllers/analyticsController');

router.use(protect);

router.get('/dashboard', analyticsController.getDashboardStats);
router.get('/campaigns/:id/stats', analyticsController.getCampaignStats);
router.get('/recent-activity', analyticsController.getRecentActivity);

module.exports = router;
