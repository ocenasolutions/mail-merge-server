const mongoose = require('mongoose');

const autoGtmCampaignSchema = new mongoose.Schema({
  campaignId: {
    type: String,
    required: true,
    index: true
  },
  userEmail: {
    type: String,
    required: true,
    index: true,
    trim: true,
    lowercase: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    default: 'Active'
  },
  stage: {
    type: String,
    default: 'Prospecting'
  },
  statusReason: {
    type: String,
    default: ''
  },
  targetUrl: {
    type: String,
    default: ''
  },
  leadsCount: {
    type: Number,
    default: 0
  },
  offer: {
    type: String,
    default: ''
  },
  customerProblem: {
    type: String,
    default: ''
  },
  targetRole: {
    type: String,
    default: 'Founder & CEO, VP of Engineering, CTO'
  },
  exampleClients: [{
    type: String
  }],
  keywords: [{
    type: String
  }],
  steerLogs: [{
    type: mongoose.Schema.Types.Mixed
  }],
  leads: [{
    type: mongoose.Schema.Types.Mixed
  }],
  template: {
    subject: { type: String, default: '' },
    body: { type: String, default: '' }
  },
  sequence: [{
    type: mongoose.Schema.Types.Mixed
  }],
  sent: {
    type: Number,
    default: 0
  },
  openedCount: {
    type: Number,
    default: 0
  },
  repliedCount: {
    type: Number,
    default: 0
  },
  openRate: {
    type: String,
    default: '0%'
  },
  replyRate: {
    type: String,
    default: '0%'
  },
  interested: {
    type: Number,
    default: 0
  },
  spent: {
    type: String,
    default: '$0.00'
  },
  dailyCap: {
    type: String,
    default: '25'
  }
}, {
  timestamps: true
});

autoGtmCampaignSchema.index({ userEmail: 1, campaignId: 1 }, { unique: true });

module.exports = mongoose.model('AutoGtmCampaign', autoGtmCampaignSchema);
