const mongoose = require('mongoose');

const B2BSearchHistorySchema = new mongoose.Schema({
  userEmail: {
    type: String,
    trim: true,
    lowercase: true,
    default: '',
    index: true
  },
  query: {
    type: String,
    required: true,
    trim: true
  },
  searchType: {
    type: String,
    enum: ['company_search', 'domain_lookup', 'competitors', 'icp_generation', 'people_search'],
    default: 'company_search'
  },
  filters: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  resultsCount: {
    type: Number,
    default: 0
  },
  provider: {
    type: String,
    default: 'explee'
  },
  topResultNames: [{ type: String }],
  snapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  }
}, {
  timestamps: true
});

B2BSearchHistorySchema.index({ userEmail: 1, createdAt: -1 });

module.exports = mongoose.model('B2BSearchHistory', B2BSearchHistorySchema);
