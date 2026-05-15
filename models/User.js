const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/encryption');

const userSchema = new mongoose.Schema({
  googleId: {
    type: String,
    required: true,
    unique: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  avatar: String,
  googleAccessToken: String,
  googleRefreshToken: {
    type: String,
    set: encrypt,
    get: decrypt
  },
  settings: {
    emailsPerMinute: {
      type: Number,
      default: 50
    },
    signature: {
      enabled: {
        type: Boolean,
        default: false
      },
      html: {
        type: String,
        default: ''
      }
    }
  }
}, {
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true }
});

module.exports = mongoose.model('User', userSchema);
