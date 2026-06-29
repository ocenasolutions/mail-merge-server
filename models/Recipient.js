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
    enum: ['pending', 'processing', 'retrying', 'sent', 'failed', 'paused', 'bounced'],
    default: 'pending'
  },
  deliveryJobId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CampaignDispatchJob'
  },
  attemptCount: {
    type: Number,
    default: 0
  },
  lastAttemptAt: Date,
  nextAttemptAt: Date,
  lockedBy: String,
  lockedAt: Date,
  leaseExpiresAt: Date,
  idempotencyKey: {
    type: String,
    index: true
  },
  jobKey: String,
  messageId: String,
  sentAt: Date,
  sentSubject: String,
  providerMessageId: String,
  sentBy: String,
  isFallbackUsed: {
    type: Boolean,
    default: false
  },
  followUpStatus: {
    type: String,
    enum: ['none', 'sent'],
    default: 'none'
  },
  followUpSentAt: Date,
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
recipientSchema.index({ campaignId: 1, status: 1, nextAttemptAt: 1 });
recipientSchema.index({ campaignId: 1, leaseExpiresAt: 1 });
recipientSchema.index({ campaignId: 1, status: 1 });
recipientSchema.index({ campaignId: 1, sentAt: 1 });

module.exports = mongoose.model('Recipient', recipientSchema);
