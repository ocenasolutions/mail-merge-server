const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const emailConfigController = require('../controllers/emailConfigController');

router.use(protect);

router.route('/')
  .get(emailConfigController.getConfigs)
  .post(emailConfigController.createConfig);

router.route('/:id')
  .get(emailConfigController.getConfig)
  .put(emailConfigController.updateConfig)
  .delete(emailConfigController.deleteConfig);

router.post('/:id/test-connection', emailConfigController.testConnection);
router.post('/:id/test', emailConfigController.testConfig);

module.exports = router;
