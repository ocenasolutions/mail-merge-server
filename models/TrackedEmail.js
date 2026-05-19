const mongoose = require('mongoose');

const trackedEmailSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  trackingId: {
    type: String,
    required: true,
    unique: true
  },
  providerMessageId: String,
  senderEmail: {
    type: String,
    required: true
  },
  recipientEmail: {
    type: String,
    required: true
  },
  cc: String,
  bcc: String,
  subject: String,
  content: String,
  trackingEnabled: {
    type: Boolean,
    default: false
  },
  openCount: {
    type: Number,
    default: 0
  },
  clickCount: {
    type: Number,
    default: 0
  },
  firstOpenedAt: Date,
  lastOpenedAt: Date,
  clicks: [{
    url: String,
    timestamp: Date,
    userAgent: String,
    ip: String
  }]
}, {
  timestamps: true
});

trackedEmailSchema.index({ userId: 1, createdAt: -1 });
trackedEmailSchema.index({ providerMessageId: 1 }, { sparse: true });

module.exports = mongoose.model('TrackedEmail', trackedEmailSchema);
