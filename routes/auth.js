const express = require('express');
const router = express.Router();
const passport = require('passport');
const jwt = require('jsonwebtoken');
const { protect } = require('../middleware/auth');

const hasGoogleOAuthConfig = () => Boolean(
  process.env.GOOGLE_CLIENT_ID &&
  process.env.GOOGLE_CLIENT_SECRET &&
  process.env.GOOGLE_CALLBACK_URL
);

// @route   GET /api/auth/google
// @desc    Initiate Google OAuth
router.get('/google', (req, res, next) => {
  if (!hasGoogleOAuthConfig()) {
    return res.status(503).json({
      success: false,
      message: 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL in NextJS_EmailDROP/.env.local or .env.'
    });
  }

  // Get the origin from referer header or query parameter
  // FRONTEND_URL takes precedence over CLIENT_URL for clarity
  const defaultOrigin = process.env.FRONTEND_URL || process.env.CLIENT_URL;
  let origin = req.query.origin || req.headers.referer || defaultOrigin;
  
  // Clean up the origin to get just the base URL
  try {
    const url = new URL(origin);
    origin = `${url.protocol}//${url.host}`;
  } catch (error) {
    origin = defaultOrigin;
  }
  
  console.log('Initiating OAuth with origin:', origin);
  
  // Always force consent to ensure fresh tokens with all scopes
  passport.authenticate('google', {
    scope: [
      'profile', 
      'email', 
      'https://www.googleapis.com/auth/spreadsheets',     // Google Sheets access
      'https://www.googleapis.com/auth/gmail.send',       // Gmail send access
      'https://www.googleapis.com/auth/gmail.readonly',   // Gmail read access
      'https://www.googleapis.com/auth/gmail.modify'      // Gmail modify access (for drafts, labels)
    ],
    accessType: 'offline',
    prompt: 'consent',  // Always show consent screen to get fresh refresh token
    state: Buffer.from(origin).toString('base64') // Pass origin as state
  })(req, res, next);
});

// @route   GET /api/auth/google/callback
// @desc    Google OAuth callback
router.get('/google/callback',
  (req, res, next) => {
    if (!hasGoogleOAuthConfig()) {
      return res.status(503).json({
        success: false,
        message: 'Google OAuth is not configured on this server.'
      });
    }

    return next();
  },
  passport.authenticate('google', { session: false, failureRedirect: `${process.env.FRONTEND_URL || process.env.CLIENT_URL}/login` }),
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

    // Determine the redirect URL based on state parameter or environment variable
    // FRONTEND_URL takes precedence over CLIENT_URL for clarity
    let frontendUrl = process.env.FRONTEND_URL || process.env.CLIENT_URL;
    
    try {
      // Get origin from state parameter if provided
      if (req.query.state) {
        const decodedOrigin = Buffer.from(req.query.state, 'base64').toString('utf-8');
        if (decodedOrigin.startsWith('http')) {
          frontendUrl = decodedOrigin;
        }
      }
    } catch (error) {
      console.error('Error decoding state:', error);
    }

    console.log('Redirecting to frontend:', frontendUrl);
    console.log('Full redirect URL:', `${frontendUrl}/auth/callback`);
    
    // IMPORTANT: Redirect to FRONTEND, not backend
    res.redirect(`${frontendUrl}/auth/callback?token=${token}&user=${encodeURIComponent(JSON.stringify(userData))}`);
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

router.put('/me/settings', protect, async (req, res) => {
  try {
    const settingsPatch = req.body?.settings || {};
    const nextSettings = {
      ...req.user.settings?.toObject?.(),
      ...settingsPatch,
      signature: {
        ...(req.user.settings?.signature || {}),
        ...(settingsPatch.signature || {})
      }
    };

    req.user.settings = nextSettings;
    await req.user.save();

    res.json({
      success: true,
      data: req.user
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
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
