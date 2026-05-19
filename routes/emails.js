const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const emailController = require('../controllers/emailController');

router.use(protect);

// Get emails by folder
router.get('/', emailController.getEmails);

// Send email
router.post('/send', emailController.sendEmail);

// Save draft
router.post('/draft', emailController.saveDraft);

// Delete email
router.delete('/:id', emailController.deleteEmail);

// Mark as read
router.put('/:id/read', emailController.markAsRead);

// Get single email
router.get('/:id', emailController.getEmail);

module.exports = router;
