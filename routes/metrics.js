const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const systemController = require('../controllers/systemController');

router.use(protect);

router.get('/campaign-pipeline', systemController.getPipelineMetrics);
router.get('/health', systemController.getHealth);
router.get('/system', systemController.getSystemMetrics);

module.exports = router;
