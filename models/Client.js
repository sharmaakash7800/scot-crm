const mongoose = require('mongoose');

const contactPersonSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
    default: ''
  },
  designation: {
    type: String,
    trim: true,
    default: ''
  },
  phone: {
    type: String,
    trim: true,
    default: ''
  },
  email: {
    type: String,
    trim: true,
    default: ''
  },
  isPrimary: {
    type: Boolean,
    default: false
  }
}, { _id: true });

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
  // Normalized lowercase name for strict duplicate prevention
  normalizedName: {
    type: String,
    trim: true,
    index: true
  },
  // Primary contact summary (backward compatibility)
  contactNumber: {
    type: String,
    trim: true,
    default: ''
  },
  // Child table / list of multiple company employees & contact persons
  contacts: [contactPersonSchema],
  clientType: {
    type: String,
    enum: ['Client', 'Vendor'],
    default: 'Client',
    index: true
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
    enum: ['Pending', 'Taken / Done', 'Not Required', 'Not Planned', 'Planned', 'Done'],
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

// Auto-sync normalizedName before save
clientSchema.pre('save', function(next) {
  if (this.clientName) {
    this.normalizedName = this.clientName.trim().toLowerCase().replace(/\s+/g, ' ');
  }
  next();
});

module.exports = mongoose.model('Client', clientSchema);

