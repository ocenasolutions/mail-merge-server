const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  sheetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Sheet',
    required: true
  },
  emailConfigId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EmailConfig',
    required: true
  },
  emailColumn: {
    type: String,
    required: true
  },
  subject: {
    type: String,
    required: true
  },
  body: {
    type: String,
    required: true
  },
  trackingEnabled: {
    type: Boolean,
    default: true
  },
  useSignature: {
    type: Boolean,
    default: true
  },
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'sending', 'completed', 'paused', 'failed'],
    default: 'draft'
  },
  scheduledAt: Date,
  startedAt: Date,
  completedAt: Date,
  stats: {
    total: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    opened: { type: Number, default: 0 },
    bounced: { type: Number, default: 0 },
    clicked: { type: Number, default: 0 }
  }
}, {
  timestamps: true
});

campaignSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('Campaign', campaignSchema);
