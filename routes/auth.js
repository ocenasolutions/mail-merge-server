const express = require('express');
const router = express.Router();
const passport = require('passport');
const jwt = require('jsonwebtoken');
const { protect } = require('../middleware/auth');

// @route   GET /api/auth/google
// @desc    Initiate Google OAuth
router.get('/google', (req, res, next) => {
  // Get the origin from referer header or query parameter
  let origin = req.query.origin || req.headers.referer || process.env.CLIENT_URL;
  
  // Clean up the origin to get just the base URL
  try {
    const url = new URL(origin);
    origin = `${url.protocol}//${url.host}`;
  } catch (error) {
    origin = process.env.CLIENT_URL;
  }
  
  passport.authenticate('google', {
    scope: [
      'profile', 
      'email', 
      'https://www.googleapis.com/auth/spreadsheets'  // Changed from .readonly to full access
    ],
    accessType: 'offline',
    prompt: 'consent',
    state: Buffer.from(origin).toString('base64') // Pass origin as state
  })(req, res, next);
});

// @route   GET /api/auth/google/callback
// @desc    Google OAuth callback
router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: `${process.env.CLIENT_URL}/mail-merge/login` }),
  (req, res) => {
    const token = jwt.sign({ id: req.user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRE
    });

    // Include user data in the redirect
    const userData = {
      _id: req.user._id,
      email: req.user.email,
      name: req.user.name
    };

    // Determine the redirect URL based on state parameter
    let baseUrl = process.env.CLIENT_URL;
    
    try {
      // Get origin from state parameter
      if (req.query.state) {
        const decodedOrigin = Buffer.from(req.query.state, 'base64').toString('utf-8');
        if (decodedOrigin.startsWith('http')) {
          baseUrl = decodedOrigin;
        }
      }
    } catch (error) {
      console.error('Error decoding state:', error);
    }
    
    res.redirect(`${baseUrl}/mail-merge/auth/callback?token=${token}&user=${encodeURIComponent(JSON.stringify(userData))}`);
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
