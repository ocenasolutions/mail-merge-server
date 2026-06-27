const express = require('express');
const router = express.Router();
const multer = require('multer');
const { protect } = require('../middleware/auth');
const campaignController = require('../controllers/campaignController');
const upload = multer({ storage: multer.memoryStorage() });

router.use(protect);

router.get('/stats', campaignController.getStats);

router.route('/')
  .get(campaignController.getCampaigns)
  .post(upload.array('attachments', 10), campaignController.createCampaign);

router.route('/:id')
  .get(campaignController.getCampaign)
  .put(campaignController.updateCampaign)
  .delete(campaignController.deleteCampaign);

router.post('/:id/preview', campaignController.previewCampaign);
router.post('/ai-draft', campaignController.generateAiDraft);
router.post('/:id/send', campaignController.sendCampaign);
router.post('/:id/pause', campaignController.pauseCampaign);
router.post('/:id/resume', campaignController.resumeCampaign);
router.post('/:id/restart', campaignController.restartCampaign);
router.post('/:id/retry-failed', campaignController.retryFailed);
router.post('/:id/retry-selected', campaignController.retrySelected);
router.post('/:id/retry-one', campaignController.retryOne);
router.get('/:id/dlq', campaignController.getDeadLetters);
router.post('/:id/dlq/:deadLetterId/requeue', campaignController.requeueDeadLetter);
router.post('/:id/update-sheet', campaignController.updateSheet);
router.post('/test-email', campaignController.testEmail);
router.get('/:id/recipients', campaignController.getRecipients);
router.post('/:id/recipients/:recipientId/follow-up', campaignController.sendFollowUp);

module.exports = router;
