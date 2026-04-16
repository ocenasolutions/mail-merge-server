const mongoose = require('mongoose');

const sheetSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sheetId: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  url: String,
  columns: [{
    name: String,
    index: Number
  }],
  lastSynced: Date
}, {
  timestamps: true
});

sheetSchema.index({ userId: 1 });

module.exports = mongoose.model('Sheet', sheetSchema);
