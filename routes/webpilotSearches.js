const express = require('express');
const SavedSearch = require('../models/SavedSearch');
const { seedTestCompanies } = require('../services/seedTestCompanies');

const router = express.Router();

// @route   GET /api/searches
// @desc    Get saved website search analyses for current user
router.get('/searches', async (req, res) => {
  try {
    const rawEmail = req.query.userEmail || req.headers['x-user-email'] || '';
    const userEmail = typeof rawEmail === 'string' ? rawEmail.toLowerCase().trim() : '';

    const filterQuery = userEmail
      ? { $or: [{ userEmail }, { userEmail: '' }, { userEmail: null }] }
      : {};

    // Select summary fields for fast history listing
    const searches = await SavedSearch.find(filterQuery)
      .select('prompt siteName siteDomain searchType scrapedCompany icpProfile createdAt leads icpLeads userEmail')
      .sort({ createdAt: -1 })
      .limit(50);

    const summaries = searches.map((s) => ({
      id: s._id,
      prompt: s.prompt,
      siteName: s.siteName,
      siteDomain: s.siteDomain,
      searchType: s.searchType,
      industry: s.scrapedCompany?.industry || 'Software & Tech Services',
      competitorsCount: s.leads?.length || 0,
      icpLeadsCount: s.icpLeads?.length || 0,
      createdAt: s.createdAt,
      userEmail: s.userEmail || '',
    }));

    return res.json({
      success: true,
      count: summaries.length,
      searches: summaries,
    });
  } catch (error) {
    console.error('Error fetching saved searches:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/searches/:id
// @desc    Get full payload of a saved search by ID
router.get('/searches/:id', async (req, res) => {
  try {
    const search = await SavedSearch.findById(req.params.id);
    if (!search) {
      return res.status(404).json({ success: false, message: 'Saved search not found' });
    }
    return res.json({
      success: true,
      search,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// @route   DELETE /api/searches/:id
// @desc    Delete a saved search
router.delete('/searches/:id', async (req, res) => {
  try {
    const deleted = await SavedSearch.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Saved search not found' });
    }
    return res.json({
      success: true,
      message: 'Saved website analysis removed successfully',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
