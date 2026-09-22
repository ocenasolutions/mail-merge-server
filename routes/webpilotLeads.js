const express = require('express');
const router = express.Router();
const { mockCompanies, addCompany, clearCompanies } = require('../services/mockDatabase');

/**
 * GET /api/leads
 * Get all available leads
 */
router.get('/leads', (req, res) => {
  const formattedLeads = mockCompanies.map(comp => ({
    ...comp,
    matchScore: 85,
    matchedReasoning: `Indexed company profile in ${comp.industry} (${comp.location}).`,
    primaryContact: (comp.contacts && comp.contacts[0]) || null
  }));

  res.json({
    success: true,
    total: formattedLeads.length,
    leads: formattedLeads
  });
});

/**
 * POST /api/leads
 * Add a new real lead / company to the database
 */
router.post('/leads', (req, res) => {
  try {
    const companyData = req.body;
    if (!companyData.name) {
      return res.status(400).json({
        success: false,
        error: 'Company name is required'
      });
    }

    const createdLead = addCompany(companyData);
    res.status(201).json({
      success: true,
      lead: createdLead
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to create lead'
    });
  }
});

/**
 * DELETE /api/leads
 * Clear all leads from the database
 */
router.delete('/leads', (req, res) => {
  clearCompanies();
  res.json({
    success: true,
    message: 'Database cleared'
  });
});

/**
 * GET /api/leads/:id
 * Get single lead contact & company breakdown
 */
router.get('/leads/:id', (req, res) => {
  const { id } = req.params;
  const company = mockCompanies.find(c => c.id === id);

  if (!company) {
    return res.status(404).json({
      success: false,
      error: 'Lead not found'
    });
  }

  res.json({
    success: true,
    lead: company
  });
});

module.exports = router;
