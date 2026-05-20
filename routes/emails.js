const express = require('express');
const router = express.Router();
const multer = require('multer');
const { protect } = require('../middleware/auth');
const emailController = require('../controllers/emailController');
const upload = multer({ storage: multer.memoryStorage() });

router.use(protect);

// Get emails by folder
router.get('/', emailController.getEmails);

// Send email
router.post('/send', upload.array('attachments', 10), emailController.sendEmail);

// Save draft
router.post('/draft', emailController.saveDraft);

// Delete email
router.delete('/:id', emailController.deleteEmail);

// Mark as read
router.put('/:id/read', emailController.markAsRead);

// Get single email
router.get('/:id', emailController.getEmail);

module.exports = router;
