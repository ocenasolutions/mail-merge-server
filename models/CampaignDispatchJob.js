const mongoose = require('mongoose');

const campaignDispatchJobSchema = new mongoose.Schema({
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  recipientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Recipient',
    required: true
  },
  recipientEmail: {
    type: String,
    required: true,
    index: true
  },
  jobKey: {
    type: String,
    required: true
  },
  idempotencyKey: {
    type: String,
    required: true,
    unique: true
  },
  messageId: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'retrying', 'sent', 'failed', 'paused'],
    default: 'pending',
    index: true
  },
  attemptCount: {
    type: Number,
    default: 0
  },
  maxAttempts: {
    type: Number,
    default: 8
  },
  claimedBy: String,
  claimedAt: Date,
  leaseExpiresAt: Date,
  nextAttemptAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  lastAttemptAt: Date,
  sentAt: Date,
  provider: String,
  providerMessageId: String,
  sentSubject: String,
  lastError: {
    message: String,
    statusCode: Number,
    providerStatus: String,
    retryable: Boolean,
    retryAfterMs: Number,
    details: mongoose.Schema.Types.Mixed
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

campaignDispatchJobSchema.index({ campaignId: 1, recipientId: 1 }, { unique: true });
campaignDispatchJobSchema.index({ jobKey: 1 }, { unique: true });
campaignDispatchJobSchema.index({ messageId: 1 }, { unique: true });
campaignDispatchJobSchema.index({ campaignId: 1, status: 1, nextAttemptAt: 1, leaseExpiresAt: 1 });
campaignDispatchJobSchema.index({ status: 1, nextAttemptAt: 1, leaseExpiresAt: 1 });

module.exports = mongoose.model('CampaignDispatchJob', campaignDispatchJobSchema);
