const { runCompanyIntelligencePipeline } = require('../services/companyIntelligenceService');

/**
 * POST /api/company-intelligence
 * Local Company Competitor & ICP Discovery Endpoint
 */
async function getCompanyIntelligence(req, res) {
  try {
    const { company, location, radiusKm } = req.body;

    if (!company || typeof company !== 'string' || !company.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: "company" must be a non-empty string.'
      });
    }

    if (!location || typeof location !== 'string' || !location.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: "location" must be a non-empty string.'
      });
    }

    const radius = Number(radiusKm) || 25;
    const userEmail = req.headers['x-user-email'] || req.user?.email || '';

    const result = await runCompanyIntelligencePipeline(company, location, radius, userEmail);

    return res.json({
      success: true,
      ...result
    });

  } catch (err) {
    console.error('Company Intelligence API error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Server error processing company intelligence discovery'
    });
  }
}

/**
 * GET /api/company-intelligence/history
 * Fetch all saved company intelligence searches for user
 */
async function getCompanyIntelligenceHistory(req, res) {
  try {
    const CompanyIntelligenceSearch = require('../models/CompanyIntelligenceSearch');
    const userEmail = (req.query.userEmail || req.headers['x-user-email'] || req.user?.email || '').toLowerCase().trim();
    const filter = userEmail ? { userEmail } : {};
    
    const searches = await CompanyIntelligenceSearch.find(filter)
      .sort({ createdAt: -1 })
      .limit(50);

    return res.json({
      success: true,
      count: searches.length,
      searches
    });
  } catch (err) {
    console.error('Company Intelligence History API error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Server error fetching company intelligence history'
    });
  }
}

module.exports = {
  getCompanyIntelligence,
  getCompanyIntelligenceHistory
};
