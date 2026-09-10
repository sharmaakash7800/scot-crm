const mongoose = require('mongoose');

const enquirySchema = new mongoose.Schema({
  monthKey: {
    type: String, // e.g. 'Apr 26', 'May 26'
    required: true,
    unique: true
  },
  year: {
    type: Number,
    default: 2026
  },
  monthIndex: {
    type: Number, // 0 for Apr, 1 for May, ..., 11 for Mar
    required: true
  },
  totalOrdersOrEnquiries: {
    type: Number,
    default: 0
  },
  ordersNotFollowedUp: {
    type: Number,
    default: 0
  },
  totalValueOfOrders: {
    type: Number,
    default: 0
  },
  notFollowedPercentage: {
    type: Number,
    default: 0
  }
});

module.exports = mongoose.model('Enquiry', enquirySchema);
