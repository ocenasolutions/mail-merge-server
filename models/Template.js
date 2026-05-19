const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
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
  html: {
    type: String
  },
  thumbnail: {
    type: String
  }
}, {
  timestamps: true
});

templateSchema.index({ userId: 1 });

module.exports = mongoose.model('Template', templateSchema);
