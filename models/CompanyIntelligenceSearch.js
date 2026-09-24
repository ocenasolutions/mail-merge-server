const mongoose = require('mongoose');

const CompanyIntelligenceSearchSchema = new mongoose.Schema({
  userEmail: {
    type: String,
    trim: true,
    lowercase: true,
    default: ''
  },
  companyQuery: {
    type: String,
    required: true,
    trim: true
  },
  locationQuery: {
    type: String,
    required: true,
    trim: true
  },
  radiusKm: {
    type: Number,
    default: 25
  },
  targetCompany: {
    name: { type: String, default: null },
    address: { type: String, default: null },
    website: { type: String, default: null },
    phone: { type: String, default: null },
    category: { type: String, default: null },
    rating: { type: Number, default: null },
    reviewCount: { type: Number, default: null },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    industry: { type: String, default: null },
    services: [{ type: String }]
  },
  competitors: [{
    id: String,
    name: String,
    website: String,
    address: String,
    phone: String,
    industry: String,
    services: [String],
    latitude: Number,
    longitude: Number,
    distanceKm: Number,
    competitorScore: Number,
    classification: String,
    reasons: [String]
  }],
  icps: [{
    id: String,
    name: String,
    website: String,
    address: String,
    phone: String,
    industry: String,
    location: String,
    companySize: String,
    latitude: Number,
    longitude: Number,
    distanceKm: Number,
    icpScore: Number,
    classification: String,
    reasons: [String]
  }],
  meta: {
    radiusKm: Number,
    totalCompaniesFound: Number,
    competitorsFound: Number,
    icpsFound: Number
  },
  rawData: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

CompanyIntelligenceSearchSchema.index({ companyQuery: 1, locationQuery: 1, radiusKm: 1 });

module.exports = mongoose.model('CompanyIntelligenceSearch', CompanyIntelligenceSearchSchema);
