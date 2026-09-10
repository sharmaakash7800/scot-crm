const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const xlsx = require('xlsx');
const cors = require('cors');
require('dotenv').config();

const connectDB = require('./db');
const Client = require('./models/Client');
const Transaction = require('./models/Transaction');
const Enquiry = require('./models/Enquiry');
const FollowUp = require('./models/FollowUp');
const { importExcelData, cleanNumber, parseDate } = require('./import_excel');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Upload configuration for Excel imports
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

// Financial Year Months Definitions (FY 2026-27)
const FY_MONTHS = [
  { key: "Apr'26", name: 'April 2026', endDate: '2026-04-30', sheetTab: 'Scot_Apr26' },
  { key: "May'26", name: 'May 2026', endDate: '2026-05-31', sheetTab: 'Scot_May26' },
  { key: "Jun'26", name: 'June 2026', endDate: '2026-06-30', sheetTab: 'Scot_Jun26' },
  { key: "Jul'26", name: 'July 2026', endDate: '2026-07-31', sheetTab: 'Scot_Jul26' },
  { key: "Aug'26", name: 'August 2026', endDate: '2026-08-31', sheetTab: 'Scot_Aug26' },
  { key: "Sep'26", name: 'September 2026', endDate: '2026-09-30', sheetTab: 'Scot_Sep26' },
  { key: "Oct'26", name: 'October 2026', endDate: '2026-10-31', sheetTab: 'Scot_Oct26' },
  { key: "Nov'26", name: 'November 2026', endDate: '2026-11-30', sheetTab: 'Scot_Nov26' },
  { key: "Dec'26", name: 'December 2026', endDate: '2026-12-31', sheetTab: 'Scot_Dec26' },
  { key: "Jan'27", name: 'January 2027', endDate: '2027-01-31', sheetTab: 'Scot_Jan27' },
  { key: "Feb'27", name: 'February 2027', endDate: '2027-02-28', sheetTab: 'Scot_Feb27' },
  { key: "Mar'27", name: 'March 2027', endDate: '2027-03-31', sheetTab: 'Scot_Mar27' }
];

// Helper to compute SCOT calculations for a given cutoff date
async function computeScotForDate(cutoffDate) {
  const clients = await Client.find().lean();
  const transactions = await Transaction.find({ date: { $lte: cutoffDate } })
    .sort({ date: 1 })
    .lean();

  // Group transactions by clientName (case-insensitive key)
  const txByClient = new Map();
  for (const tx of transactions) {
    const key = (tx.clientName || '').trim().toLowerCase();
    if (!txByClient.has(key)) {
      txByClient.set(key, []);
    }
    txByClient.get(key).push(tx);
  }

  const results = clients.map(client => {
    const key = (client.clientName || '').trim().toLowerCase();
    const clientTxList = txByClient.get(key) || [];

    const totalInvoices = clientTxList.length;
    let totalSales = 0;
    let firstOrderDate = client.firstOrderDate || null;
    let lastOrderDate = null;
    let lastInvoiceNo = '';
    let lastOrderAmount = 0;

    if (totalInvoices > 0) {
      for (const tx of clientTxList) {
        totalSales += (Number(tx.amount) || 0);
      }
      const firstTxDate = new Date(clientTxList[0].date);
      if (!firstOrderDate || firstTxDate < new Date(firstOrderDate)) {
        firstOrderDate = firstTxDate;
      }
      const lastTx = clientTxList[clientTxList.length - 1];
      lastOrderDate = new Date(lastTx.date);
      lastInvoiceNo = lastTx.invoiceNo || '';
      lastOrderAmount = Number(lastTx.amount) || 0;
    }

    let daysSinceLastOrder = 9999;
    let status = 'No Orders Yet';

    if (lastOrderDate) {
      const diffMs = cutoffDate.getTime() - lastOrderDate.getTime();
      daysSinceLastOrder = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

      if (daysSinceLastOrder <= 30) {
        status = 'Active (0-30 days)';
      } else if (daysSinceLastOrder <= 90) {
        status = 'Slow (31-90 days)';
      } else if (daysSinceLastOrder < 182) {
        status = 'At Risk (91-181 days)';
      } else {
        status = 'Inactive (6+ months)';
      }
    }

    const usualOrderGap = Number(client.usualOrderGap) || 0;
    const avgOrderSize = totalInvoices > 0 ? (totalSales / totalInvoices) : 0;

    return {
      _id: client._id,
      uniqueId: client.uniqueId,
      clientName: client.clientName,
      contactNumber: client.contactNumber,
      address: client.address,
      firstOrderDate,
      lastOrderDate,
      daysSinceLastOrder,
      lastInvoiceNo,
      lastOrderAmount,
      totalInvoices,
      totalSales,
      status,
      usualOrderGap,
      avgOrderSize,
      lastFollowUpDate: client.lastFollowUpDate || null,
      nextFollowUpDate: client.nextFollowUpDate || null,
      followUpTakenBy: client.followUpTakenBy || '',
      followUpStatus: client.followUpStatus || 'Pending',
      lastFeedback: client.lastFeedback || ''
    };
  });

  return results;
}

// ==================== REST API ROUTES ==================== //

// 1. Overall System Summary & Overview
app.get('/api/stats', async (req, res) => {
  try {
    const totalClients = await Client.countDocuments();
    const totalTransactions = await Transaction.countDocuments();
    
    // Aggregation for total revenue
    const salesAgg = await Transaction.aggregate([
      { $group: { _id: null, totalRevenue: { $sum: '$amount' } } }
    ]);
    const totalSalesAllTime = salesAgg.length > 0 ? salesAgg[0].totalRevenue : 0;

    const totalEnquiries = await Enquiry.countDocuments();

    res.json({
      success: true,
      totalClients,
      totalTransactions,
      totalSalesAllTime,
      totalEnquiries,
      months: FY_MONTHS
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Client Master API
app.get('/api/clients', async (req, res) => {
  try {
    const { search, limit = 2000 } = req.query;
    let query = {};
    if (search) {
      query.$or = [
        { clientName: { $regex: search, $options: 'i' } },
        { contactNumber: { $regex: search, $options: 'i' } },
        { uniqueId: { $regex: search, $options: 'i' } }
      ];
    }
    const clients = await Client.find(query).limit(Number(limit)).sort({ uniqueId: 1 });
    res.json({ success: true, count: clients.length, clients });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/clients', async (req, res) => {
  try {
    const { clientName, contactNumber, address, usualOrderGap, firstOrderDate, uniqueId } = req.body;
    if (!clientName) {
      return res.status(400).json({ success: false, error: 'Client Name is required' });
    }

    let uid = uniqueId;
    if (!uid) {
      const count = await Client.countDocuments();
      uid = `Scot${String(count + 1).padStart(4, '0')}`;
    }

    const client = new Client({
      uniqueId: uid,
      clientName: clientName.trim(),
      contactNumber: (contactNumber || '').trim(),
      address: (address || '').trim(),
      usualOrderGap: Number(usualOrderGap) || 0,
      firstOrderDate: firstOrderDate ? new Date(firstOrderDate) : null
    });

    await client.save();
    res.json({ success: true, client });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/clients/:id', async (req, res) => {
  try {
    const {
      clientName,
      contactNumber,
      address,
      usualOrderGap,
      firstOrderDate,
      nextFollowUpDate,
      followUpTakenBy,
      followUpStatus,
      lastFeedback
    } = req.body;

    const updateData = {};
    if (clientName !== undefined) updateData.clientName = clientName.trim();
    if (contactNumber !== undefined) updateData.contactNumber = contactNumber.trim();
    if (address !== undefined) updateData.address = address.trim();
    if (usualOrderGap !== undefined) updateData.usualOrderGap = Number(usualOrderGap) || 0;
    if (firstOrderDate !== undefined) updateData.firstOrderDate = firstOrderDate ? new Date(firstOrderDate) : null;
    if (nextFollowUpDate !== undefined) updateData.nextFollowUpDate = nextFollowUpDate ? new Date(nextFollowUpDate) : null;
    if (followUpTakenBy !== undefined) updateData.followUpTakenBy = followUpTakenBy.trim();
    if (followUpStatus !== undefined) updateData.followUpStatus = followUpStatus;
    if (lastFeedback !== undefined) updateData.lastFeedback = lastFeedback.trim();

    const client = await Client.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );
    res.json({ success: true, client });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/clients/:id', async (req, res) => {
  try {
    await Client.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Client deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Transactions API
app.get('/api/transactions', async (req, res) => {
  try {
    const { search, limit = 500, skip = 0 } = req.query;
    let query = {};
    if (search) {
      query.$or = [
        { clientName: { $regex: search, $options: 'i' } },
        { invoiceNo: { $regex: search, $options: 'i' } }
      ];
    }
    const total = await Transaction.countDocuments(query);
    const transactions = await Transaction.find(query)
      .sort({ date: -1 })
      .skip(Number(skip))
      .limit(Number(limit));

    res.json({ success: true, total, count: transactions.length, transactions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/transactions', async (req, res) => {
  try {
    const { date, clientName, invoiceNo, amount } = req.body;
    if (!clientName || amount === undefined) {
      return res.status(400).json({ success: false, error: 'Client Name and Amount are required' });
    }

    const txDate = date ? new Date(date) : new Date();

    // Auto-create client in Master if not exists
    let client = await Client.findOne({ clientName: { $regex: `^${clientName.trim()}$`, $options: 'i' } });
    if (!client) {
      const count = await Client.countDocuments();
      client = await Client.create({
        uniqueId: `Scot${String(count + 1).padStart(4, '0')}`,
        clientName: clientName.trim(),
        firstOrderDate: txDate
      });
    }

    const tx = new Transaction({
      date: txDate,
      clientName: client.clientName,
      clientId: client._id,
      invoiceNo: invoiceNo ? invoiceNo.trim() : '',
      amount: Number(amount) || 0
    });

    await tx.save();
    res.json({ success: true, transaction: tx });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/transactions/:id', async (req, res) => {
  try {
    await Transaction.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Transaction deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Enquiry & Leaking Bucket API
app.get('/api/enquiries', async (req, res) => {
  try {
    const enquiries = await Enquiry.find().sort({ monthIndex: 1 });
    res.json({ success: true, enquiries });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/enquiries', async (req, res) => {
  try {
    const { monthKey, monthIndex, totalOrdersOrEnquiries, ordersNotFollowedUp, totalValueOfOrders } = req.body;
    const totalOrders = Number(totalOrdersOrEnquiries) || 0;
    const notFollowed = Number(ordersNotFollowedUp) || 0;
    const pct = totalOrders > 0 ? (notFollowed / totalOrders) : 0;

    const enquiry = await Enquiry.findOneAndUpdate(
      { monthKey },
      {
        monthKey,
        monthIndex: Number(monthIndex) || 0,
        totalOrdersOrEnquiries: totalOrders,
        ordersNotFollowedUp: notFollowed,
        totalValueOfOrders: Number(totalValueOfOrders) || 0,
        notFollowedPercentage: pct
      },
      { upsert: true, new: true }
    );
    res.json({ success: true, enquiry });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4.1 Follow-Up & CRE CRM API Routes
// Get followups (can filter by date, today, clientId, month/year)
app.get('/api/followups', async (req, res) => {
  try {
    const { date, clientId, month, year, today } = req.query;
    let query = {};

    if (clientId) {
      query.clientId = clientId;
    }

    if (today === 'true') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);

      // Follow-up scheduled for today OR call taken today
      query.$or = [
        { nextFollowUpDate: { $gte: startOfDay, $lte: endOfDay } },
        { callDate: { $gte: startOfDay, $lte: endOfDay } }
      ];
    } else if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      query.$or = [
        { nextFollowUpDate: { $gte: start, $lte: end } },
        { callDate: { $gte: start, $lte: end } }
      ];
    } else if (month && year) {
      const m = parseInt(month, 10);
      const y = parseInt(year, 10);
      const start = new Date(y, m, 1);
      const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
      query.$or = [
        { nextFollowUpDate: { $gte: start, $lte: end } },
        { callDate: { $gte: start, $lte: end } }
      ];
    }

    const followups = await FollowUp.find(query).sort({ nextFollowUpDate: 1, callDate: -1 });
    res.json({ success: true, count: followups.length, followups });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Today's Follow-up agenda with complete client details
app.get('/api/followups/today', async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // Find followups scheduled for today or overdue pending followups
    const scheduled = await FollowUp.find({
      nextFollowUpDate: { $lte: endOfDay },
      isCompleted: { $ne: true }
    }).sort({ nextFollowUpDate: 1 }).lean();

    // Populate client details
    const populated = await Promise.all(
      scheduled.map(async (f) => {
        let client = null;
        if (f.clientId) {
          client = await Client.findById(f.clientId).lean();
        }
        if (!client && f.clientName) {
          client = await Client.findOne({ clientName: f.clientName }).lean();
        }
        return {
          ...f,
          clientDetails: client || {
            clientName: f.clientName,
            contactNumber: f.contactNumber,
            address: '-',
            usualOrderGap: 0
          }
        };
      })
    );

    res.json({ success: true, count: populated.length, followups: populated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Calendar events API (returns call logs & scheduled follow-ups grouped by date)
app.get('/api/followups/calendar', async (req, res) => {
  try {
    const { month, year } = req.query;
    const now = new Date();
    const m = month !== undefined ? parseInt(month, 10) : now.getMonth();
    const y = year !== undefined ? parseInt(year, 10) : now.getFullYear();

    const start = new Date(y, m, 1, 0, 0, 0);
    const end = new Date(y, m + 1, 0, 23, 59, 59);

    const events = await FollowUp.find({
      $or: [
        { callDate: { $gte: start, $lte: end } },
        { nextFollowUpDate: { $gte: start, $lte: end } }
      ]
    }).lean();

    res.json({ success: true, month: m, year: y, events });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create new CRE call entry
app.post('/api/followups', async (req, res) => {
  try {
    const {
      clientId,
      clientName,
      contactNumber,
      callDate,
      creName,
      callStatus,
      customerFeedback,
      nextFollowUpDate,
      orderExpectedAmount,
      sentiment
    } = req.body;

    if (!clientName || !customerFeedback) {
      return res.status(400).json({ success: false, error: 'Client Name and Customer Feedback are required' });
    }

    let clientDoc = null;
    if (clientId) {
      clientDoc = await Client.findById(clientId);
    }
    if (!clientDoc && clientName) {
      clientDoc = await Client.findOne({ clientName: clientName.trim() });
    }

    const followUp = new FollowUp({
      clientId: clientDoc ? clientDoc._id : null,
      clientName: clientDoc ? clientDoc.clientName : clientName.trim(),
      contactNumber: contactNumber || (clientDoc ? clientDoc.contactNumber : ''),
      callDate: callDate ? new Date(callDate) : new Date(),
      creName: (creName || 'CRE Executive').trim(),
      callStatus: callStatus || 'Connected',
      customerFeedback: customerFeedback.trim(),
      nextFollowUpDate: nextFollowUpDate ? new Date(nextFollowUpDate) : null,
      orderExpectedAmount: Number(orderExpectedAmount) || 0,
      sentiment: sentiment || 'Positive',
      isCompleted: false
    });

    await followUp.save();

    // Sync latest follow-up status, executive name, and next date to Client Master
    if (clientDoc) {
      clientDoc.lastFollowUpDate = followUp.callDate;
      clientDoc.nextFollowUpDate = followUp.nextFollowUpDate;
      clientDoc.followUpTakenBy = followUp.creName;
      clientDoc.followUpStatus = 'Taken / Done';
      clientDoc.lastFeedback = followUp.customerFeedback;
      await clientDoc.save();
    }

    res.json({ success: true, followUp });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Mark follow-up as completed
app.patch('/api/followups/:id/complete', async (req, res) => {
  try {
    const followUp = await FollowUp.findByIdAndUpdate(
      req.params.id,
      { isCompleted: true },
      { new: true }
    );
    res.json({ success: true, followUp });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete follow-up
app.delete('/api/followups/:id', async (req, res) => {
  try {
    await FollowUp.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Follow-up deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Monthly SCOT Computed Sheet
app.get('/api/scot-month/:monthKey', async (req, res) => {
  try {
    const monthKey = req.params.monthKey;
    const monthInfo = FY_MONTHS.find(m => m.key.toLowerCase() === monthKey.toLowerCase()) || FY_MONTHS[0];
    const cutoffDate = new Date(monthInfo.endDate + 'T23:59:59.999Z');

    const scotRows = await computeScotForDate(cutoffDate);

    // Compute Summary Stats for this month:
    const totalClients = scotRows.length;
    let activeClients = 0;
    let slowClients = 0;
    let atRiskClients = 0;
    let inactiveHalfYear = 0;
    let noOrdersYet = 0;
    let lostSalesInactive = 0;

    // Irregular clients: Days > Usual Gap and Days < 182
    let irregularClients = 0;
    let lostSalesIrregular = 0;

    // Below benchmark order value: Last Order Amount < Avg Order Size
    let belowBenchmark = 0;

    let totalSalesThisCutoff = 0;

    for (const r of scotRows) {
      totalSalesThisCutoff += r.totalSales;

      if (r.daysSinceLastOrder >= 182) {
        inactiveHalfYear++;
        lostSalesInactive += r.avgOrderSize;
      }

      if (r.daysSinceLastOrder !== 9999 && r.usualOrderGap > 0) {
        if (r.daysSinceLastOrder > r.usualOrderGap && r.daysSinceLastOrder < 182) {
          irregularClients++;
          lostSalesIrregular += r.avgOrderSize;
        }
      }

      if (r.lastOrderAmount > 0 && r.lastOrderAmount < r.avgOrderSize) {
        belowBenchmark++;
      }

      if (r.status.startsWith('Active')) activeClients++;
      else if (r.status.startsWith('Slow')) slowClients++;
      else if (r.status.startsWith('At Risk')) atRiskClients++;
      else if (r.status.startsWith('Inactive')) { /* counted above */ }
      else noOrdersYet++;
    }

    // Lookup Enquiry for this month
    const enq = await Enquiry.findOne({ monthKey: monthInfo.key });

    res.json({
      success: true,
      month: monthInfo,
      cutoffDate,
      summary: {
        totalClients,
        activeClients,
        slowClients,
        atRiskClients,
        inactiveHalfYear,
        pctInactiveHalfYear: totalClients > 0 ? (inactiveHalfYear / totalClients) : 0,
        lostSalesInactive,
        irregularClients,
        pctIrregularClients: totalClients > 0 ? (irregularClients / totalClients) : 0,
        lostSalesIrregular,
        belowBenchmark,
        pctBelowBenchmark: totalClients > 0 ? (belowBenchmark / totalClients) : 0,
        noOrdersYet,
        totalSalesThisCutoff,
        enquiryStats: enq || null
      },
      records: scotRows
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Monthly Loss & Leaking Bucket Full Year Matrix
app.get('/api/monthly-loss-matrix', async (req, res) => {
  try {
    const matrix = [];
    for (const m of FY_MONTHS) {
      const cutoffDate = new Date(m.endDate + 'T23:59:59.999Z');
      const scotRows = await computeScotForDate(cutoffDate);
      const enq = await Enquiry.findOne({ monthKey: m.key });

      const totalClients = scotRows.length;
      let inactiveHalfYear = 0;
      let lostSalesInactive = 0;
      let irregularClients = 0;
      let lostSalesIrregular = 0;
      let totalSales = 0;

      for (const r of scotRows) {
        totalSales += r.totalSales;
        if (r.daysSinceLastOrder >= 182) {
          inactiveHalfYear++;
          lostSalesInactive += r.avgOrderSize;
        }
        if (r.daysSinceLastOrder !== 9999 && r.usualOrderGap > 0 && r.daysSinceLastOrder > r.usualOrderGap && r.daysSinceLastOrder < 182) {
          irregularClients++;
          lostSalesIrregular += r.avgOrderSize;
        }
      }

      matrix.push({
        monthKey: m.key,
        name: m.name,
        totalClients,
        totalSales,
        // Leaking Bucket Enquiries
        enqDropRate: enq ? enq.notFollowedPercentage : 0,
        enqLostValue: enq ? enq.totalValueOfOrders : 0,
        // From SCOT
        irregularClients,
        pctIrregular: totalClients > 0 ? (irregularClients / totalClients) : 0,
        lostSalesIrregular,
        inactiveHalfYear,
        pctInactive: totalClients > 0 ? (inactiveHalfYear / totalClients) : 0,
        lostSalesInactive
      });
    }

    res.json({ success: true, matrix });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Upload / Re-Import Excel Route
app.post('/api/import-excel', upload.single('file'), async (req, res) => {
  try {
    let filePath = '';
    if (req.file) {
      filePath = req.file.path;
    } else {
      filePath = path.join(__dirname, 'Monthly_Scot_Automated_FY26-27 (2).xlsx');
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Excel file not found.' });
    }

    await importExcelData(filePath);
    res.json({ success: true, message: 'Excel data imported and stored into MongoDB successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Export to Excel
app.get('/api/export/scot/:monthKey', async (req, res) => {
  try {
    const monthKey = req.params.monthKey;
    const monthInfo = FY_MONTHS.find(m => m.key.toLowerCase() === monthKey.toLowerCase()) || FY_MONTHS[0];
    const cutoffDate = new Date(monthInfo.endDate + 'T23:59:59.999Z');
    const records = await computeScotForDate(cutoffDate);

    const exportData = records.map(r => ({
      'Client Name': r.clientName,
      'Contact Number': r.contactNumber,
      'Address': r.address,
      'First Order Date': r.firstOrderDate ? new Date(r.firstOrderDate).toISOString().split('T')[0] : '',
      'Last Order Date': r.lastOrderDate ? new Date(r.lastOrderDate).toISOString().split('T')[0] : '',
      'Days Since Last Order': r.daysSinceLastOrder,
      'Last Invoice No.': r.lastInvoiceNo,
      'Last Order Amount': r.lastOrderAmount,
      'Total Invoices': r.totalInvoices,
      'Total Sales': r.totalSales,
      'Follow-up Status': r.status,
      'Usual Order Gap': r.usualOrderGap,
      'Average Order Size': Math.round(r.avgOrderSize)
    }));

    const ws = xlsx.utils.json_to_sheet(exportData);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, monthInfo.key);

    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename="SCOT_${monthInfo.key}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Quick Update Client Follow-Up Details (Inline or via Table)
app.patch('/api/clients/:id/followup', async (req, res) => {
  try {
    const { nextFollowUpDate, followUpTakenBy, followUpStatus, lastFeedback } = req.body;
    const client = await Client.findById(req.params.id);
    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    if (nextFollowUpDate !== undefined) client.nextFollowUpDate = nextFollowUpDate ? new Date(nextFollowUpDate) : null;
    if (followUpTakenBy !== undefined) client.followUpTakenBy = followUpTakenBy.trim();
    if (followUpStatus !== undefined) client.followUpStatus = followUpStatus;
    if (lastFeedback !== undefined) client.lastFeedback = lastFeedback.trim();
    if (followUpStatus === 'Taken / Done') {
      client.lastFollowUpDate = new Date();
    }

    await client.save();

    // Also record a log entry in FollowUp collection
    if (lastFeedback || followUpStatus === 'Taken / Done') {
      await FollowUp.create({
        clientId: client._id,
        clientName: client.clientName,
        contactNumber: client.contactNumber,
        callDate: new Date(),
        creName: client.followUpTakenBy || 'CRE Executive',
        callStatus: followUpStatus === 'Taken / Done' ? 'Connected' : 'Call Back Requested',
        customerFeedback: client.lastFeedback || 'Follow-up status updated directly.',
        nextFollowUpDate: client.nextFollowUpDate,
        isCompleted: followUpStatus === 'Taken / Done'
      });
    }

    res.json({ success: true, client });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Google Sheets Sync API (Sync via Google Sheets CSV / Publish URL)
app.post('/api/sync-google-sheet', async (req, res) => {
  try {
    const { sheetUrl } = req.body;
    if (!sheetUrl) {
      return res.status(400).json({ success: false, error: 'Google Sheet URL is required' });
    }

    // Convert standard Google Sheet URL to direct CSV export link if necessary
    // Example: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit#gid=0
    // Becomes: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/export?format=csv
    let exportUrl = sheetUrl.trim();
    const sheetMatch = exportUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (sheetMatch && sheetMatch[1]) {
      const sheetId = sheetMatch[1];
      // Check if gid is present
      const gidMatch = exportUrl.match(/[#&]gid=([0-9]+)/);
      const gidParam = gidMatch && gidMatch[1] ? `&gid=${gidMatch[1]}` : '';
      exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gidParam}`;
    }

    console.log(`Connecting and fetching Google Sheet from: ${exportUrl}`);
    const fetchResponse = await fetch(exportUrl);
    if (!fetchResponse.ok) {
      throw new Error(`Failed to fetch Google Sheet: ${fetchResponse.statusText}. Please ensure sheet link sharing is set to "Anyone with the link can view".`);
    }

    const csvText = await fetchResponse.text();
    const workbook = xlsx.read(csvText, { type: 'string' });
    const sheetName = workbook.SheetNames[0];
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

    if (!rows || rows.length < 2) {
      return res.status(400).json({ success: false, error: 'Google Sheet appears empty or has no header row.' });
    }

    // Determine data type by examining headers
    const headerRow = rows[0].map(h => String(h || '').toLowerCase().trim());
    let importedClients = 0;
    let importedTransactions = 0;

    const isTxSheet = headerRow.some(h => h.includes('amount') || h.includes('invoice'));
    const isClientSheet = headerRow.some(h => h.includes('client') || h.includes('customer') || h.includes('name'));

    if (isTxSheet) {
      // Import as Transactions
      const dateIdx = headerRow.findIndex(h => h.includes('date'));
      const nameIdx = headerRow.findIndex(h => h.includes('client') || h.includes('customer') || h.includes('name'));
      const invIdx = headerRow.findIndex(h => h.includes('invoice'));
      const amtIdx = headerRow.findIndex(h => h.includes('amount') || h.includes('sale') || h.includes('val'));

      const txs = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[nameIdx]) continue;
        const cName = String(row[nameIdx]).trim();
        const amt = cleanNumber(row[amtIdx]);
        const d = dateIdx !== -1 ? parseDate(row[dateIdx]) : new Date();
        const inv = invIdx !== -1 && row[invIdx] ? String(row[invIdx]).trim() : '';

        txs.push({
          date: d || new Date(),
          clientName: cName,
          invoiceNo: inv,
          amount: amt
        });
      }

      if (txs.length > 0) {
        await Transaction.insertMany(txs);
        importedTransactions = txs.length;
      }
    } else if (isClientSheet) {
      // Import as Clients
      const nameIdx = headerRow.findIndex(h => h.includes('name') || h.includes('client') || h.includes('customer'));
      const contactIdx = headerRow.findIndex(h => h.includes('contact') || h.includes('phone') || h.includes('mobile'));
      const addrIdx = headerRow.findIndex(h => h.includes('address') || h.includes('location'));
      const gapIdx = headerRow.findIndex(h => h.includes('gap') || h.includes('usual'));

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[nameIdx]) continue;
        const cName = String(row[nameIdx]).trim();
        const contact = contactIdx !== -1 && row[contactIdx] ? String(row[contactIdx]).trim() : '';
        const address = addrIdx !== -1 && row[addrIdx] ? String(row[addrIdx]).trim() : '';
        const gap = gapIdx !== -1 ? cleanNumber(row[gapIdx]) : 0;

        await Client.findOneAndUpdate(
          { clientName: { $regex: `^${cName}$`, $options: 'i' } },
          {
            $setOnInsert: {
              uniqueId: `Scot${String(Date.now()).slice(-4)}${i}`
            },
            clientName: cName,
            contactNumber: contact,
            address,
            usualOrderGap: gap
          },
          { upsert: true }
        );
        importedClients++;
      }
    }

    res.json({
      success: true,
      message: `Google Sheet synced successfully! Processed ${rows.length - 1} rows (${importedTransactions} transactions, ${importedClients} clients).`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start Server after connecting to Database and auto-seeding if empty
async function start() {
  try {
    await connectDB();

    // Check if database has clients; if not, automatically seed from the Excel file in workspace
    const clientCount = await Client.countDocuments();
    if (clientCount === 0) {
      console.log('🌱 Database is empty. Seeding initial data from Monthly_Scot_Automated_FY26-27 (2).xlsx...');
      const defaultExcelPath = path.join(__dirname, 'Monthly_Scot_Automated_FY26-27 (2).xlsx');
      if (fs.existsSync(defaultExcelPath)) {
        await importExcelData(defaultExcelPath);
      }
    }

    app.listen(PORT, () => {
      console.log(`🚀 SCOT Sales & Analytics Server running at: http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
  }
}

start();
