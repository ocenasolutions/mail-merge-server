const mongoose = require('mongoose');

const recipientSchema = new mongoose.Schema({
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true
  },
  email: {
    type: String,
    required: true
  },
  mergeData: {
    type: Map,
    of: String
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'failed', 'bounced'],
    default: 'pending'
  },
  sentAt: Date,
  sentSubject: String,
  replyCount: {
    type: Number,
    default: 0
  },
  repliedAt: Date,
  latestReplySnippet: String,
  leadStatus: {
    type: String,
    enum: ['hot', 'warm', 'cold', 'not_interested', 'unknown'],
    default: 'unknown'
  },
  leadScore: {
    type: Number,
    default: 0
  },
  leadReason: String,
  error: String,
  trackingId: String
}, {
  timestamps: true
});

recipientSchema.index({ campaignId: 1, email: 1 }, { unique: true });
recipientSchema.index({ trackingId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Recipient', recipientSchema);
