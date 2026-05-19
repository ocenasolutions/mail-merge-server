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
    enum: ['gmail', 'godaddy', 'hostinger', 'smtp', 'sendgrid', 'mailgun', 'brevo'],
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
    // For IMAP/mailbox sync
    imapHost: String,
    imapPort: Number,
    imapSecure: Boolean,
    imapUsername: String,
    imapPassword: {
      type: String,
      set: encrypt,
      get: decrypt
    },
    inboxPath: String,
    sentPath: String,
    // For SendGrid/Mailgun/Brevo
    apiKey: {
      type: String,
      set: encrypt,
      get: decrypt
    },
    domain: String, // For Mailgun
    // For Gmail/SendGrid/Mailgun/Brevo
    email: String,
    fromName: String // For Brevo
  },
  // Gmail OAuth fields
  gmailAccessToken: String,
  gmailRefreshToken: {
    type: String,
    set: encrypt,
    get: decrypt
  },
  email: String,
  smtpHost: String,
  smtpPort: Number,
  smtpUsername: String,
  smtpPassword: {
    type: String,
    set: encrypt,
    get: decrypt
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
