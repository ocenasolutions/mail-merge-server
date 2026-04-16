const mongoose = require('mongoose');

const trackingSchema = new mongoose.Schema({
  recipientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Recipient',
    required: true
  },
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true
  },
  opens: [{
    timestamp: Date,
    userAgent: String,
    ip: String
  }],
  clicks: [{
    url: String,
    timestamp: Date,
    userAgent: String,
    ip: String
  }],
  openCount: {
    type: Number,
    default: 0
  },
  clickCount: {
    type: Number,
    default: 0
  },
  firstOpenedAt: Date,
  lastOpenedAt: Date
}, {
  timestamps: true
});

trackingSchema.index({ recipientId: 1 });
trackingSchema.index({ campaignId: 1 });

module.exports = mongoose.model('Tracking', trackingSchema);
