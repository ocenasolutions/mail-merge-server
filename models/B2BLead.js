const mongoose = require('mongoose');

const B2BLeadSchema = new mongoose.Schema({
  userEmail: {
    type: String,
    required: true,
    index: true,
    trim: true,
    lowercase: true,
  },
  // Company details
  company: {
    id: { type: String, default: '' },
    name: { type: String, required: true },
    domain: { type: String, default: '' },
    website: { type: String, default: '' },
    industry: { type: String, default: '' },
    location: { type: String, default: '' },
    size: { type: String, default: '' },
    description: { type: String, default: '' },
    founded: { type: Number, default: null },
    traffic: { type: Number, default: null },
    fundingStage: { type: String, default: '' },
    hiring: { type: Boolean, default: false },
    socials: {
      linkedin: { type: String, default: '' },
      twitter: { type: String, default: '' },
      github: { type: String, default: '' }
    }
  },
  // Person / Decision Maker details (only verified data)
  contact: {
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    fullName: { type: String, default: '' },
    title: { type: String, default: '' },
    headline: { type: String, default: '' },
    email: { type: String, default: '' },
    emailStatus: { type: String, enum: ['verified', 'unverified', 'unknown'], default: 'unknown' },
    phone: { type: String, default: '' },
    linkedinUrl: { type: String, default: '' },
    geo: { type: String, default: '' }
  },
  // Transparent Lead Scoring
  score: {
    relevanceScore: { type: Number, default: 0, min: 0, max: 100 },
    reasons: [{ type: String }],
    criteriaScores: [{
      criterion: { type: String },
      score: { type: Number },
      reasoning: { type: String }
    }]
  },
  // Associated ICP tags if any
  icpTags: [{ type: String }],
  notes: { type: String, default: '' },
  status: {
    type: String,
    enum: ['saved', 'contacted', 'interested', 'not_interested', 'qualified'],
    default: 'saved'
  },
  provider: {
    type: String,
    enum: ['explee', 'apollo', 'local_intel', 'synthesized'],
    default: 'explee'
  },
  providerRecordId: { type: String, default: '' },
  rawProviderData: { type: mongoose.Schema.Types.Mixed, default: null }
}, {
  timestamps: true
});

B2BLeadSchema.index({ userEmail: 1, 'company.name': 1, 'contact.email': 1 });
B2BLeadSchema.index({ userEmail: 1, createdAt: -1 });

module.exports = mongoose.model('B2BLead', B2BLeadSchema);
