const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const systemController = require('../controllers/systemController');

router.use(protect);

router.get('/campaign-pipeline', systemController.getPipelineMetrics);
router.get('/health', systemController.getHealth);
router.get('/system', systemController.getSystemMetrics);
router.get('/admin-stats', systemController.getAdminStats);
router.post('/stress-test', systemController.runStressTest);

module.exports = router;
