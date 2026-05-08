const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const campaignController = require('../controllers/campaignController');

router.use(protect);

router.get('/stats', campaignController.getStats);

router.route('/')
  .get(campaignController.getCampaigns)
  .post(campaignController.createCampaign);

router.route('/:id')
  .get(campaignController.getCampaign)
  .put(campaignController.updateCampaign)
  .delete(campaignController.deleteCampaign);

router.post('/:id/preview', campaignController.previewCampaign);
router.post('/:id/send', campaignController.sendCampaign);
router.post('/:id/pause', campaignController.pauseCampaign);
router.post('/:id/resume', campaignController.resumeCampaign);
router.post('/:id/retry-failed', campaignController.retryFailed);
router.post('/:id/retry-selected', campaignController.retrySelected);
router.post('/:id/retry-one', campaignController.retryOne);
router.post('/:id/update-sheet', campaignController.updateSheet);
router.post('/test-email', campaignController.testEmail);
router.get('/:id/recipients', campaignController.getRecipients);

module.exports = router;
