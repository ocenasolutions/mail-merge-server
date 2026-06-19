const express = require('express');
const router = express.Router();
const passport = require('passport');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { protect } = require('../middleware/auth');
const SignatureAsset = require('../models/SignatureAsset');
const logger = require('../utils/logger');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype?.startsWith('image/')) {
      return cb(new Error('Only image files are allowed.'));
    }

    cb(null, true);
  }
});

const getPublicAppUrl = (req) => {
  if (process.env.APP_URL) {
    return String(process.env.APP_URL).replace(/\/$/, '');
  }

  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${protocol}://${host}`;
};

const normalizeStoredSignatures = (incomingSignatures = [], fallbackSignature = {}) => {
  const normalized = Array.isArray(incomingSignatures)
    ? incomingSignatures
      .map((signature, index) => ({
        id: String(signature?.id || `sig_${Date.now()}_${index}`),
        name: String(signature?.name || `Signature ${index + 1}`),
        html: String(signature?.html || ''),
        enabled: signature?.enabled !== false,
        isDefault: !!signature?.isDefault
      }))
      .filter((signature) => signature.name || signature.html)
    : [];

  if (normalized.length === 0 && fallbackSignature?.html) {
    normalized.push({
      id: 'default_signature',
      name: 'Default Signature',
      html: String(fallbackSignature.html || ''),
      enabled: fallbackSignature.enabled !== false,
      isDefault: true
    });
  }

  if (normalized.length > 0 && !normalized.some((signature) => signature.isDefault)) {
    normalized[0].isDefault = true;
  }

  return normalized.map((signature, index) => ({
    ...signature,
    isDefault: normalized.findIndex((item) => item.isDefault) === index
  }));
};

const getEffectiveSignature = (storedSignatures = [], fallbackSignature = {}) => {
  const normalized = normalizeStoredSignatures(storedSignatures, fallbackSignature);
  const preferred = normalized.find((signature) => signature.isDefault) || normalized[0];

  if (!preferred) {
    return {
      signatures: [],
      signature: {
        enabled: false,
        html: ''
      }
    };
  }

  return {
    signatures: normalized,
    signature: {
      enabled: preferred.enabled !== false,
      html: preferred.enabled === false ? '' : preferred.html || ''
    }
  };
};

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
  
  logger.info({ origin }, 'Initiating OAuth flow');
  
  // Always force consent to ensure fresh tokens with all scopes
  passport.authenticate('google', {
    scope: [
      'profile', 
      'email', 
      'https://www.googleapis.com/auth/spreadsheets',     // Google Sheets access
      'https://mail.google.com/',                         // Full Gmail IMAP/SMTP OAuth scope
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
      logger.error({ err: error }, 'Error decoding OAuth state');
    }

    logger.info({ frontendUrl, redirectUrl: `${frontendUrl}/auth/callback` }, 'Redirecting to frontend');
    
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
    const effectiveSignature = getEffectiveSignature(
      settingsPatch.signatures ?? req.user.settings?.signatures,
      settingsPatch.signature ?? req.user.settings?.signature
    );
    const nextSettings = {
      ...req.user.settings?.toObject?.(),
      ...settingsPatch,
      notifications: {
        ...(req.user.settings?.notifications || {}),
        ...(settingsPatch.notifications || {})
      },
      signatures: effectiveSignature.signatures,
      signature: {
        ...(req.user.settings?.signature || {}),
        ...effectiveSignature.signature
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

router.post('/me/signature-image', protect, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Signature image is required.'
      });
    }

    const asset = await SignatureAsset.create({
      userId: req.user._id,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      data: req.file.buffer
    });

    const publicUrl = `${getPublicAppUrl(req)}/api/auth/signature-images/${asset._id}`;

    res.json({
      success: true,
      data: {
        id: asset._id,
        url: publicUrl,
        filename: asset.filename,
        mimeType: asset.mimeType,
        size: asset.size
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

router.get('/signature-images/:id', async (req, res) => {
  try {
    const asset = await SignatureAsset.findById(req.params.id).lean();

    if (!asset) {
      return res.status(404).send('Not found');
    }

    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Content-Length', asset.size);
    res.setHeader('Content-Disposition', `inline; filename="${asset.filename}"`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(asset.data);
  } catch (error) {
    res.status(404).send('Not found');
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
