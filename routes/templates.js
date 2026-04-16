const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const templateController = require('../controllers/templateController');

router.use(protect);

router.route('/')
  .get(templateController.getTemplates)
  .post(templateController.createTemplate);

router.route('/:id')
  .get(templateController.getTemplate)
  .put(templateController.updateTemplate)
  .delete(templateController.deleteTemplate);

module.exports = router;
