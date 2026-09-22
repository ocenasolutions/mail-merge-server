const mongoose = require('mongoose');

const savedSearchSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
  },
  userEmail: {
    type: String,
    required: false,
    index: true,
  },
  prompt: {
    type: String,
    required: true,
  },
  siteName: {
    type: String,
    required: true,
  },
  siteDomain: {
    type: String,
    required: true,
  },
  searchType: {
    type: String,
    enum: ['url_scraper', 'natural_language'],
    default: 'url_scraper',
  },
  scrapedCompany: {
    type: Object,
    default: null,
  },
  parsedIntent: {
    type: Object,
    default: null,
  },
  icpProfile: {
    type: Object,
    default: null,
  },
  workflowSteps: {
    type: Array,
    default: [],
  },
  leads: {
    type: Array,
    default: [],
  },
  icpLeads: {
    type: Array,
    default: [],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('SavedSearch', savedSearchSchema);
