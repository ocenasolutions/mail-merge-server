const mongoose = require('mongoose');

const campaignDeadLetterSchema = new mongoose.Schema({
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true,
    index: true
  },
  recipientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Recipient',
    required: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    index: true
  },
  provider: {
    type: String,
    required: true,
    index: true
  },
  retryCount: {
    type: Number,
    default: 0
  },
  errorCode: String,
  lastError: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  jobKey: {
    type: String,
    required: true,
    index: true
  },
  messageId: {
    type: String,
    required: true,
    index: true
  },
  providerMessageId: String,
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  requeuedAt: Date,
  requeueMeta: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  }
}, {
  timestamps: true
});

campaignDeadLetterSchema.index({ campaignId: 1, recipientId: 1, timestamp: -1 });

module.exports = mongoose.model('CampaignDeadLetter', campaignDeadLetterSchema);
