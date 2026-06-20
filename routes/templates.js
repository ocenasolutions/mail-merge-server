const express = require('express');
const router = express.Router();
const multer = require('multer');
const { protect } = require('../middleware/auth');
const templateController = require('../controllers/templateController');
const upload = multer({ storage: multer.memoryStorage() });

router.use(protect);

router.route('/')
  .get(templateController.getTemplates)
  .post(upload.array('attachments', 10), templateController.createTemplate);

router.route('/:id')
  .get(templateController.getTemplate)
  .put(upload.array('attachments', 10), templateController.updateTemplate)
  .delete(templateController.deleteTemplate);

module.exports = router;
