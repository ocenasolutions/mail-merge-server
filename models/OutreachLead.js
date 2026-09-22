const mongoose = require('mongoose');

const outreachLeadSchema = new mongoose.Schema({
  userEmail: {
    type: String,
    required: true,
    index: true,
  },
  contactName: {
    type: String,
    required: true,
  },
  contactTitle: {
    type: String,
    default: '',
  },
  contactEmail: {
    type: String,
    required: true,
  },
  companyName: {
    type: String,
    default: '',
  },
  companyDomain: {
    type: String,
    default: '',
  },
  location: {
    type: String,
    default: '',
  },
  templateName: {
    type: String,
    default: '',
  },
  sentAt: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    enum: ['sent', 'opened', 'replied'],
    default: 'sent',
  },
  leadObj: {
    type: Object,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('OutreachLead', outreachLeadSchema);
