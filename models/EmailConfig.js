const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/encryption');

const emailConfigSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  provider: {
    type: String,
    enum: ['gmail', 'smtp', 'sendgrid', 'mailgun'],
    required: true
  },
  config: {
    // For SMTP
    host: String,
    port: Number,
    secure: Boolean,
    username: String,
    password: {
      type: String,
      set: encrypt,
      get: decrypt
    },
    // For SendGrid/Mailgun
    apiKey: {
      type: String,
      set: encrypt,
      get: decrypt
    },
    domain: String, // For Mailgun
    // For Gmail
    email: String
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  verified: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true }
});

emailConfigSchema.index({ userId: 1 });

module.exports = mongoose.model('EmailConfig', emailConfigSchema);
