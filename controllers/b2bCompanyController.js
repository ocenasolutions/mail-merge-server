const {
  searchCompaniesService,
  getCompanyProfileService,
  generateIcpService,
  findCompetitorsService,
  searchPeopleService,
  calculateLeadScore,
  saveLeadService,
  getSavedLeadsService,
  deleteSavedLeadService
} = require('../services/b2bIntelligenceService');
const leadProviderManager = require('../services/leadProviders/LeadProviderManager');

/**
 * POST & GET /api/company/search
 */
async function searchCompanies(req, res) {
  try {
    const query = req.body.query || req.query.query || req.query.q || '';
    const filters = req.body.filters || {
      location: req.query.location || '',
      industry: req.query.industry || '',
      size: req.query.size ? [req.query.size] : [],
      criteria: req.body.criteria || []
    };
    const page = Number(req.body.page || req.query.page) || 1;
    const pageSize = Number(req.body.pageSize || req.query.pageSize || req.query.limit) || 20;
    const userEmail = req.headers['x-user-email'] || req.user?.email || req.query.userEmail || '';

    if (!query && !filters.location && !filters.industry) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a search query, company name, domain, industry, or location.'
      });
    }

    const result = await searchCompaniesService({
      query: String(query).trim(),
      filters,
      page,
      pageSize,
      userEmail
    });

    return res.json(result);
  } catch (err) {
    console.error('B2B Company Search Controller Error:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || 'Error occurred while searching for companies'
    });
  }
}

/**
 * GET /api/company/:id
 */
async function getCompanyById(req, res) {
  try {
    const { id } = req.params;
    const domain = req.query.domain || '';
    const criteria = req.query.criteria ? String(req.query.criteria).split(',') : [];

    const result = await getCompanyProfileService({ id, domain, criteria });
    if (!result.success) {
      return res.status(404).json(result);
    }
    return res.json(result);
  } catch (err) {
    console.error('B2B Company Profile Error:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || 'Error fetching company profile'
    });
  }
}

/**
 * POST /api/company/:id/icp or POST /api/company/icp
 */
async function generateCompanyIcp(req, res) {
  try {
    const companyId = req.params.id || req.body.companyId || '';
    const domain = req.body.domain || req.query.domain || '';
    const company = req.body.company || null;
    const context = req.body.context || '';

    const result = await generateIcpService({
      company,
      companyId,
      domain,
      context
    });

    return res.json(result);
  } catch (err) {
    console.error('B2B ICP Generation Error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Error generating Ideal Customer Profile'
    });
  }
}

/**
 * GET /api/company/:id/competitors or POST /api/company/competitors
 */
async function getCompanyCompetitors(req, res) {
  try {
    const companyId = req.params.id || req.body.companyId || '';
    const domain = req.body?.domain || req.query.domain || '';
    const company = req.body?.company || null;
    const industry = req.body?.industry || req.query.industry || '';
    const location = req.body?.location || req.query.location || '';
    const limit = Number(req.query.limit || req.body?.limit) || 10;

    const result = await findCompetitorsService({
      company,
      companyId,
      domain,
      industry,
      location,
      limit
    });

    return res.json(result);
  } catch (err) {
    console.error('B2B Competitors Discovery Error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Error finding potential competitors'
    });
  }
}

/**
 * GET /api/company/:id/people or POST /api/company/people
 */
async function getCompanyPeople(req, res) {
  try {
    const companyId = req.params.id || req.body.companyId || '';
    const domain = req.body?.domain || req.query.domain || (companyId.includes('.') ? companyId : '');
    const companyName = req.body?.companyName || req.query.companyName || '';
    const jobTitles = req.body?.jobTitles || (req.query.titles ? req.query.titles.split(',') : []);
    const page = Number(req.query.page || req.body?.page) || 1;
    const pageSize = Number(req.query.pageSize || req.body?.pageSize || req.query.limit) || 10;

    const result = await searchPeopleService({
      domain,
      companyId,
      companyName,
      jobTitles,
      page,
      pageSize
    });

    return res.json(result);
  } catch (err) {
    console.error('B2B People Search Error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Error finding decision makers'
    });
  }
}

/**
 * POST /api/leads/score
 */
function scoreLead(req, res) {
  try {
    const { company, person, query, criteria } = req.body;
    if (!company) {
      return res.status(400).json({
        success: false,
        error: 'Company data object is required for lead scoring.'
      });
    }

    const scoring = calculateLeadScore({ company, person, query, criteria });
    return res.json({
      success: true,
      scoring
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Error scoring lead'
    });
  }
}

/**
 * POST /api/leads/save
 */
async function saveLead(req, res) {
  try {
    const userEmail = req.headers['x-user-email'] || req.user?.email || req.body.userEmail;
    if (!userEmail) {
      return res.status(400).json({
        success: false,
        error: 'User email is required. Please login or provide x-user-email header.'
      });
    }

    const { company, contact, score, icpTags, notes, provider, rawProviderData } = req.body;
    const result = await saveLeadService({
      userEmail,
      company,
      contact,
      score,
      icpTags,
      notes,
      provider,
      rawProviderData
    });

    return res.status(201).json(result);
  } catch (err) {
    console.error('Save B2B Lead Error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Error saving lead'
    });
  }
}

/**
 * GET /api/leads/saved
 */
async function getSavedLeads(req, res) {
  try {
    const userEmail = req.headers['x-user-email'] || req.user?.email || req.query.userEmail;
    if (!userEmail) {
      return res.status(400).json({
        success: false,
        error: 'User email is required to view saved leads.'
      });
    }

    const limit = Number(req.query.limit) || 50;
    const status = req.query.status || '';

    const result = await getSavedLeadsService({ userEmail, limit, status });
    return res.json(result);
  } catch (err) {
    console.error('Get Saved Leads Error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Error retrieving saved leads'
    });
  }
}

/**
 * DELETE /api/leads/saved/:id
 */
async function deleteSavedLead(req, res) {
  try {
    const userEmail = req.headers['x-user-email'] || req.user?.email || req.query.userEmail;
    if (!userEmail) {
      return res.status(400).json({
        success: false,
        error: 'User email is required.'
      });
    }

    const { id } = req.params;
    const result = await deleteSavedLeadService({ userEmail, leadId: id });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Error deleting lead'
    });
  }
}

/**
 * GET /api/company/providers/status
 */
async function getProvidersStatus(req, res) {
  try {
    const status = await leadProviderManager.getStatus();
    return res.json({
      success: true,
      status
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Error fetching providers status'
    });
  }
}

module.exports = {
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
};
