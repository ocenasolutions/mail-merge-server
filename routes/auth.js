const express = require('express');
const router = express.Router();
const passport = require('passport');
const jwt = require('jsonwebtoken');
const { protect } = require('../middleware/auth');

// @route   GET /api/auth/google
// @desc    Initiate Google OAuth
router.get('/google', passport.authenticate('google', {
  scope: [
    'profile', 
    'email', 
    'https://www.googleapis.com/auth/spreadsheets'  // Changed from .readonly to full access
  ],
  accessType: 'offline',
  prompt: 'consent'
}));

// @route   GET /api/auth/google/callback
// @desc    Google OAuth callback
router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: `${process.env.CLIENT_URL}/login` }),
  (req, res) => {
    const token = jwt.sign({ id: req.user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRE
    });

    res.redirect(`${process.env.CLIENT_URL}/auth/callback?token=${token}`);
  }
);

// @route   GET /api/auth/me
// @desc    Get current user
router.get('/me', protect, async (req, res) => {
  res.json({
    success: true,
    data: req.user
  });
});

// @route   POST /api/auth/logout
// @desc    Logout user
router.post('/logout', protect, (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// @route   DELETE /api/auth/account
// @desc    Delete user account (for testing/reset)
router.delete('/account', protect, async (req, res) => {
  try {
    await req.user.deleteOne();
    res.json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
