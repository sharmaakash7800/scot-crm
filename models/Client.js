const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  uniqueId: {
    type: String,
    trim: true,
    unique: true,
    sparse: true
  },
  clientName: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  contactNumber: {
    type: String,
    trim: true,
    default: ''
  },
  address: {
    type: String,
    trim: true,
    default: ''
  },
  usualOrderGap: {
    type: Number,
    default: 0
  },
  firstOrderDate: {
    type: Date,
    default: null
  },
  lastFollowUpDate: {
    type: Date,
    default: null
  },
  nextFollowUpDate: {
    type: Date,
    default: null
  },
  followUpTakenBy: {
    type: String,
    trim: true,
    default: ''
  },
  followUpStatus: {
    type: String,
    enum: ['Pending', 'Taken / Done', 'Not Required'],
    default: 'Pending'
  },
  lastFeedback: {
    type: String,
    trim: true,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Client', clientSchema);
