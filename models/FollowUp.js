const mongoose = require('mongoose');

const followUpSchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
    index: true
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
  callDate: {
    type: Date,
    required: true,
    default: Date.now,
    index: true
  },
  creName: {
    type: String,
    trim: true,
    default: 'CRE Executive'
  },
  callStatus: {
    type: String,
    enum: ['Connected', 'Busy / No Answer', 'Call Back Requested', 'Wrong Number', 'Order Promised', 'Not Interested'],
    default: 'Connected'
  },
  customerFeedback: {
    type: String,
    required: true,
    trim: true
  },
  nextFollowUpDate: {
    type: Date,
    index: true
  },
  orderExpectedAmount: {
    type: Number,
    default: 0
  },
  sentiment: {
    type: String,
    enum: ['Positive', 'Neutral', 'Negative'],
    default: 'Positive'
  },
  isCompleted: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('FollowUp', followUpSchema);
