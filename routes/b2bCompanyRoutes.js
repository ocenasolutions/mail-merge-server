const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const {
  searchCompanies,
  getCompanyById,
  generateCompanyIcp,
  getCompanyCompetitors,
  getCompanyPeople,
  scoreLead,
  saveLead,
  getSavedLeads,
  deleteSavedLead,
  getProvidersStatus
} = require('../controllers/b2bCompanyController');

// Rate limiting for B2B intelligence search (120 req / 15 mins)
const b2bSearchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many search requests. Please wait a few moments before searching again.'
  }
});

// Provider status
router.get('/company/providers/status', getProvidersStatus);

// Company Search
router.post('/company/search', b2bSearchLimiter, searchCompanies);
router.get('/company/search', b2bSearchLimiter, searchCompanies);

// Company ICP Generation (before :id wildcard or with :id)
router.post('/company/icp', generateCompanyIcp);
router.post('/company/:id/icp', generateCompanyIcp);

// Competitors Discovery
router.post('/company/competitors', getCompanyCompetitors);
router.get('/company/:id/competitors', getCompanyCompetitors);

// People / Decision Makers Search
router.post('/company/people', getCompanyPeople);
router.get('/company/:id/people', getCompanyPeople);

// Company Profile Lookup
router.get('/company/:id', getCompanyById);

// Lead Scoring & Saving
router.post('/leads/score', scoreLead);
router.post('/leads/save', saveLead);
router.get('/leads/saved', getSavedLeads);
router.delete('/leads/saved/:id', deleteSavedLead);

module.exports = router;
