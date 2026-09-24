const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { getCompanyIntelligence, getCompanyIntelligenceHistory } = require('../controllers/companyIntelligenceController');

// Rate limiting middleware for company intelligence API (Step 14)
const intelligenceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60, // Limit each IP to 60 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests to company intelligence API. Please wait a moment before trying again.'
  }
});

// GET /api/company-intelligence/history
router.get('/company-intelligence/history', getCompanyIntelligenceHistory);

// POST /api/company-intelligence
router.post('/company-intelligence', intelligenceLimiter, getCompanyIntelligence);

module.exports = router;
