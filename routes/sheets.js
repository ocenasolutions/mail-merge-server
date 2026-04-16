const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const sheetController = require('../controllers/sheetController');

router.use(protect);

router.route('/')
  .get(sheetController.getSheets)
  .post(sheetController.connectSheet);

router.route('/:id')
  .get(sheetController.getSheet)
  .delete(sheetController.deleteSheet);

router.get('/:id/data', sheetController.getSheetData);
router.post('/:id/sync', sheetController.syncSheet);

module.exports = router;
