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
const Executive = require('./models/Executive');
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

// Helper to compute SCOT calculations for a given cutoff date and optional monthInfo
async function computeScotForDate(cutoffDate, monthInfo = null) {
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

  // If monthInfo is provided, calculate the month date range to resolve month-specific follow-ups
  let monthFollowUpsMap = new Map();
  if (monthInfo && monthInfo.endDate) {
    const mEnd = new Date(monthInfo.endDate + 'T23:59:59.999Z');
    const mStart = new Date(Date.UTC(mEnd.getUTCFullYear(), mEnd.getUTCMonth(), 1, 0, 0, 0));

    // Find all FollowUp records either planned for this month OR calls taken in this month
    const monthFollowups = await FollowUp.find({
      $or: [
        { nextFollowUpDate: { $gte: mStart, $lte: mEnd } },
        { callDate: { $gte: mStart, $lte: mEnd } }
      ]
    }).sort({ callDate: 1, nextFollowUpDate: 1 }).lean();

    // Group by client ID or client Name (lowercase)
    for (const f of monthFollowups) {
      const cIdKey = f.clientId ? String(f.clientId) : '';
      const nameKey = (f.clientName || '').trim().toLowerCase();
      
      const targetKeys = [];
      if (cIdKey) targetKeys.push(cIdKey);
      if (nameKey) targetKeys.push(nameKey);

      for (const k of targetKeys) {
        if (!monthFollowUpsMap.has(k)) {
          monthFollowUpsMap.set(k, []);
        }
        monthFollowUpsMap.get(k).push(f);
      }
    }
  }

  const results = clients.map(client => {
    const key = (client.clientName || '').trim().toLowerCase();
    const clientIdStr = String(client._id);
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

    let daysSinceLastOrder = null;
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

    // Month-scoped follow-up resolution:
    let monthPlannedDate = null;
    let monthActualDate = null;
    let monthFollowUpStatus = 'Not Set';
    let monthRemark = '';
    let monthExecutive = '';

    if (monthInfo) {
      const mEnd = new Date(monthInfo.endDate + 'T23:59:59.999Z');
      const mStart = new Date(Date.UTC(mEnd.getUTCFullYear(), mEnd.getUTCMonth(), 1, 0, 0, 0));

      const fList = monthFollowUpsMap.get(clientIdStr) || monthFollowUpsMap.get(key) || [];
      
      // Look for any call made in this month
      const callsInMonth = fList.filter(f => f.callDate && new Date(f.callDate) >= mStart && new Date(f.callDate) <= mEnd);
      // Look for any follow-up planned for this month
      const plannedInMonth = fList.filter(f => f.nextFollowUpDate && new Date(f.nextFollowUpDate) >= mStart && new Date(f.nextFollowUpDate) <= mEnd);

      if (callsInMonth.length > 0) {
        const latestCall = callsInMonth[callsInMonth.length - 1];
        monthActualDate = latestCall.callDate;
        monthFollowUpStatus = 'Taken / Done';
        monthRemark = latestCall.customerFeedback || '';
        monthExecutive = latestCall.creName || '';
      }

      if (plannedInMonth.length > 0) {
        const firstPlanned = plannedInMonth[0];
        monthPlannedDate = firstPlanned.nextFollowUpDate;
        if (!monthExecutive) monthExecutive = firstPlanned.creName || '';
        if (monthFollowUpStatus !== 'Taken / Done') {
          monthFollowUpStatus = 'Pending';
          if (!monthRemark) monthRemark = firstPlanned.customerFeedback || '';
        }
      }
    } else {
      // Fallback to global client fields when no specific month requested
      monthPlannedDate = client.nextFollowUpDate || null;
      monthActualDate = client.lastFollowUpDate || null;
      monthExecutive = client.followUpTakenBy || '';
      monthFollowUpStatus = client.followUpStatus || 'Not Set';
      monthRemark = client.lastFeedback || '';
    }

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
      // Month-specific follow-up fields
      plannedDate: monthPlannedDate,
      actualDate: monthActualDate,
      followUpTakenBy: monthExecutive,
      followUpStatus: monthFollowUpStatus,
      remark: monthRemark,
      // Master global fields preserved for backward compatibility
      contacts: client.contacts || [],
      lastFollowUpDate: client.lastFollowUpDate || null,
      nextFollowUpDate: client.nextFollowUpDate || null,
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

// 2. Dashboard Follow-up Execution Stats
app.get('/api/dashboard/followup-stats', async (req, res) => {
  try {
    const { period } = req.query; // 'today', 'week', 'month', 'all'
    const now = new Date();
    let startDate = new Date(0); // default to beginning of time
    let endDate = new Date('2099-12-31T23:59:59.999Z');

    if (period === 'today') {
      startDate = new Date(now.setHours(0, 0, 0, 0));
      endDate = new Date(now.setHours(23, 59, 59, 999));
    } else if (period === 'week') {
      const day = now.getDay() || 7; // Get current day number, converting Sun. to 7
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      startDate.setDate(startDate.getDate() - day + 1); // Monday
      endDate = new Date(now.setHours(23, 59, 59, 999));
    } else if (period === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    // 1. Fetch FollowUps in this period
    const followupsInPeriod = await FollowUp.find({
      callDate: { $gte: startDate, $lte: endDate }
    }).lean();

    // 2. Fetch Clients (for calculating Pending / Overdue)
    // Overdue = nextFollowUpDate < today (start of today)
    // Pending = nextFollowUpDate >= today AND <= end of period
    // Due = Overdue + Pending
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const clients = await Client.find({}, 'clientName followUpStatus nextFollowUpDate followUpTakenBy').lean();
    
    let dueCount = 0;
    let pendingCount = 0;
    let overdueCount = 0;

    clients.forEach(c => {
      if (!c.nextFollowUpDate) return;
      if (c.followUpStatus === 'Taken / Done') return; // already done, not pending
      
      const nextDate = new Date(c.nextFollowUpDate);
      if (nextDate < todayStart) {
        overdueCount++;
        dueCount++; // Overdue is part of total Due backlog
      } else if (nextDate >= startDate && nextDate <= endDate) {
        pendingCount++;
        dueCount++;
      }
    });

    const callsMade = followupsInPeriod.length;
    const uniqueClientsContacted = new Set(followupsInPeriod.map(f => f.clientId?.toString())).size;
    const connectedCalls = followupsInPeriod.filter(f => f.callStatus === 'Connected').length;
    
    // Follow-ups Done (Approximation: any log where it was connected or order promised)
    const followupsDone = followupsInPeriod.filter(f => f.callStatus === 'Connected' || f.callStatus === 'Order Promised').length;
    
    // Leads Generated: Expecting order amount > 0
    const leadsGenerated = followupsInPeriod.filter(f => (f.orderExpectedAmount || 0) > 0).length;

    // Follow-up to Lead Conversion %
    let conversionPercent = 0;
    if (followupsDone > 0) {
      conversionPercent = ((leadsGenerated / followupsDone) * 100).toFixed(1);
    }

    // Daily Activity Graph Data (Aggregate by day for the period)
    const dailyActivity = {};
    followupsInPeriod.forEach(f => {
      const day = new Date(f.callDate).toISOString().split('T')[0];
      if (!dailyActivity[day]) dailyActivity[day] = { calls: 0, leads: 0 };
      dailyActivity[day].calls++;
      if ((f.orderExpectedAmount || 0) > 0) dailyActivity[day].leads++;
    });

    // Upcoming Tasks Graph (Today, Tomorrow, Next 7, 15, 30)
    let upToday = 0, upTomorrow = 0, up7 = 0, up15 = 0, up30 = 0;
    const tStart = new Date(todayStart);
    const tmrwStart = new Date(todayStart); tmrwStart.setDate(tmrwStart.getDate() + 1);
    const d7Start = new Date(todayStart); d7Start.setDate(d7Start.getDate() + 7);
    const d15Start = new Date(todayStart); d15Start.setDate(d15Start.getDate() + 15);
    const d30Start = new Date(todayStart); d30Start.setDate(d30Start.getDate() + 30);

    clients.forEach(c => {
      if (!c.nextFollowUpDate || c.followUpStatus === 'Taken / Done') return;
      const nd = new Date(c.nextFollowUpDate);
      if (nd >= tStart && nd < tmrwStart) upToday++;
      else if (nd >= tmrwStart && nd < new Date(tmrwStart.getTime() + 86400000)) upTomorrow++;
      else if (nd >= tStart && nd < d7Start) up7++;
      else if (nd >= tStart && nd < d15Start) up15++;
      else if (nd >= tStart && nd < d30Start) up30++;
    });

    // CRE-wise Performance Array
    const creMap = {};
    followupsInPeriod.forEach(f => {
      const cre = f.creName || 'Unassigned';
      if (!creMap[cre]) creMap[cre] = { calls: 0, connected: 0, followupsDone: 0, leads: 0, pending: 0, overdue: 0, assigned: 0 };
      
      creMap[cre].calls++;
      if (f.callStatus === 'Connected') creMap[cre].connected++;
      if (f.callStatus === 'Connected' || f.callStatus === 'Order Promised') creMap[cre].followupsDone++;
      if ((f.orderExpectedAmount || 0) > 0) creMap[cre].leads++;
    });
    
    clients.forEach(c => {
       const cre = c.followUpTakenBy;
       if (!cre) return;
       if (!creMap[cre]) creMap[cre] = { calls: 0, connected: 0, followupsDone: 0, leads: 0, pending: 0, overdue: 0, assigned: 0 };
       
       creMap[cre].assigned++;
       if (c.followUpStatus !== 'Taken / Done' && c.nextFollowUpDate) {
         const nd = new Date(c.nextFollowUpDate);
         if (nd < todayStart) creMap[cre].overdue++;
         else if (nd >= startDate && nd <= endDate) creMap[cre].pending++;
       }
    });

    const crePerformance = Object.keys(creMap).map(cre => {
      const data = creMap[cre];
      let conv = 0;
      if (data.followupsDone > 0) conv = ((data.leads / data.followupsDone) * 100).toFixed(1);
      return { cre, ...data, conversionPercent: conv };
    });

    res.json({
      success: true,
      dueCount,
      followupsDone,
      pendingCount,
      overdueCount,
      callsMade,
      uniqueClientsContacted,
      connectedCalls,
      leadsGenerated,
      conversionPercent,
      dailyActivity,
      upcomingTasks: {
        today: upToday,
        tomorrow: upTomorrow,
        next7: up7,
        next15: up15,
        next30: up30
      },
      crePerformance
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Client Master API
app.get('/api/clients', async (req, res) => {
  try {
    const { search, limit = 2000, type } = req.query;
    let query = {};
    if (type && type !== 'all') {
      query.clientType = type;
    }
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

// Get Single Client by ID
app.get('/api/clients/:id', async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }
    res.json({ success: true, client });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/clients', async (req, res) => {
  try {
    const {
      clientName,
      contactNumber,
      contacts,
      clientType,
      address,
      usualOrderGap,
      firstOrderDate,
      uniqueId,
      nextFollowUpDate,
      followUpTakenBy,
      followUpStatus,
      lastFeedback
    } = req.body;

    if (!clientName || !clientName.trim()) {
      return res.status(400).json({ success: false, error: 'Company / Client Name is required' });
    }

    const trimmedName = clientName.trim();
    const normalized = trimmedName.toLowerCase().replace(/\s+/g, ' ');

    // Duplicate company validation (case-insensitive & extra-space insensitive)
    const existingCompany = await Client.findOne({
      $or: [
        { normalizedName: normalized },
        { clientName: { $regex: `^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }
      ]
    });

    if (existingCompany) {
      return res.status(409).json({
        success: false,
        error: `Company "${trimmedName}" already exists in Master with ID ${existingCompany.uniqueId || existingCompany._id}. Duplicate companies are not allowed. Please edit the existing record or add contact persons to it.`
      });
    }

    let uid = uniqueId;
    if (!uid) {
      const count = await Client.countDocuments();
      uid = `Scot${String(count + 1).padStart(4, '0')}`;
    }

    // Parse contacts if provided
    let parsedContacts = [];
    if (Array.isArray(contacts)) {
      parsedContacts = contacts.filter(c => c && (c.name || c.phone || c.email || c.designation));
    }

    const client = new Client({
      uniqueId: uid,
      clientName: trimmedName,
      normalizedName: normalized,
      contactNumber: (contactNumber || '').trim(),
      contacts: parsedContacts,
      clientType: clientType === 'Vendor' ? 'Vendor' : 'Client',
      address: (address || '').trim(),
      usualOrderGap: Number(usualOrderGap) || 0,
      firstOrderDate: firstOrderDate ? new Date(firstOrderDate) : null,
      nextFollowUpDate: nextFollowUpDate ? new Date(nextFollowUpDate) : null,
      followUpTakenBy: (followUpTakenBy || '').trim(),
      followUpStatus: followUpStatus || 'Pending',
      lastFeedback: (lastFeedback || '').trim()
    });

    await client.save();
    res.json({ success: true, client });
  } catch (err) {
    console.error('Error creating client:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/clients/:id', async (req, res) => {
  try {
    const {
      clientName,
      contactNumber,
      contacts,
      clientType,
      address,
      usualOrderGap,
      firstOrderDate,
      nextFollowUpDate,
      followUpTakenBy,
      followUpStatus,
      lastFeedback
    } = req.body;

    const clientId = req.params.id;
    const existing = await Client.findById(clientId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Client record not found' });
    }

    // If clientName is changing, verify no other company already has that normalized name
    if (clientName && clientName.trim() !== existing.clientName) {
      const trimmedName = clientName.trim();
      const normalized = trimmedName.toLowerCase().replace(/\s+/g, ' ');
      const duplicate = await Client.findOne({
        _id: { $ne: clientId },
        $or: [
          { normalizedName: normalized },
          { clientName: { $regex: `^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }
        ]
      });

      if (duplicate) {
        return res.status(409).json({
          success: false,
          error: `Another company named "${trimmedName}" already exists (ID: ${duplicate.uniqueId || duplicate._id}). Company names must be unique.`
        });
      }
      existing.clientName = trimmedName;
      existing.normalizedName = normalized;
    }

    if (clientType !== undefined) existing.clientType = clientType === 'Vendor' ? 'Vendor' : 'Client';
    if (address !== undefined) existing.address = address.trim();
    if (usualOrderGap !== undefined) existing.usualOrderGap = Number(usualOrderGap) || 0;
    if (firstOrderDate !== undefined) existing.firstOrderDate = firstOrderDate ? new Date(firstOrderDate) : null;
    if (nextFollowUpDate !== undefined) existing.nextFollowUpDate = nextFollowUpDate ? new Date(nextFollowUpDate) : null;
    if (followUpTakenBy !== undefined) existing.followUpTakenBy = followUpTakenBy.trim();
    if (followUpStatus !== undefined) existing.followUpStatus = followUpStatus;
    if (lastFeedback !== undefined) existing.lastFeedback = lastFeedback.trim();

    // Update contacts list if provided
    if (Array.isArray(contacts)) {
      existing.contacts = contacts.filter(c => c && (c.name || c.phone || c.email || c.designation));
      // Sync primary contact number
      const primary = existing.contacts.find(c => c.isPrimary) || existing.contacts[0];
      if (primary && primary.phone) {
        existing.contactNumber = primary.phone;
      }
    } else if (contactNumber !== undefined) {
      existing.contactNumber = contactNumber.trim();
    }

    await existing.save();
    res.json({ success: true, client: existing });
  } catch (err) {
    console.error('Error updating client:', err);
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

// Bulk Delete Clients API
app.post('/api/clients/bulk-delete', async (req, res) => {
  try {
    const { clientIds } = req.body;
    if (!clientIds || !Array.isArray(clientIds) || clientIds.length === 0) {
      return res.status(400).json({ success: false, error: 'No client IDs provided' });
    }

    const result = await Client.deleteMany({ _id: { $in: clientIds } });
    res.json({ success: true, message: `Successfully deleted ${result.deletedCount} clients`, deletedCount: result.deletedCount });
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

// Today's Follow-up agenda with complete client details, quick filters, executive filter & counters
app.get('/api/followups/today', async (req, res) => {
  try {
    const { filter, date, executive, search } = req.query;

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const tomorrowEnd = new Date(todayEnd);
    tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

    // Compute live counters across the system
    const [pendingCount, dueTodayCount, dueTomorrowCount, overdueCount, completedCount, totalAssignedCount, distinctCREs] = await Promise.all([
      FollowUp.countDocuments({ isCompleted: { $ne: true } }),
      FollowUp.countDocuments({
        nextFollowUpDate: { $gte: todayStart, $lte: todayEnd },
        isCompleted: { $ne: true }
      }),
      FollowUp.countDocuments({
        nextFollowUpDate: { $gte: tomorrowStart, $lte: tomorrowEnd },
        isCompleted: { $ne: true }
      }),
      FollowUp.countDocuments({
        nextFollowUpDate: { $lt: todayStart },
        isCompleted: { $ne: true }
      }),
      FollowUp.countDocuments({ isCompleted: true }),
      FollowUp.countDocuments({}),
      Executive.distinct('name', { isActive: true })
    ]);

    // Build specific query for the agenda list based on filters
    let query = {};

    if (filter === 'tomorrow') {
      query.nextFollowUpDate = { $gte: tomorrowStart, $lte: tomorrowEnd };
      query.isCompleted = { $ne: true };
    } else if (filter === 'overdue') {
      query.nextFollowUpDate = { $lt: todayStart };
      query.isCompleted = { $ne: true };
    } else if (filter === 'completed') {
      query.isCompleted = true;
    } else if (filter === 'all') {
      // no date restriction
    } else if (date) {
      const selected = new Date(date);
      const selStart = new Date(selected);
      selStart.setHours(0, 0, 0, 0);
      const selEnd = new Date(selected);
      selEnd.setHours(23, 59, 59, 999);
      query.nextFollowUpDate = { $gte: selStart, $lte: selEnd };
    } else {
      // Default: Today or overdue pending
      query.nextFollowUpDate = { $lte: todayEnd };
      query.isCompleted = { $ne: true };
    }

    if (executive && executive.trim() && executive !== 'all') {
      query.creName = executive.trim();
    }

    if (search && search.trim()) {
      const sRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { clientName: sRegex },
        { contactNumber: sRegex },
        { creName: sRegex }
      ];
    }

    const scheduled = await FollowUp.find(query).sort({ nextFollowUpDate: 1 }).lean();

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
            uniqueId: client?.uniqueId || '',
            address: '-',
            usualOrderGap: 0
          }
        };
      })
    );

    res.json({
      success: true,
      count: populated.length,
      followups: populated,
      counts: {
        pending: pendingCount,
        dueToday: dueTodayCount,
        dueTomorrow: dueTomorrowCount,
        overdue: overdueCount,
        completed: completedCount,
        totalAssigned: totalAssignedCount
      },
      executives: distinctCREs.filter(Boolean)
    });
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

    const scotRows = await computeScotForDate(cutoffDate, monthInfo);

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

      if (r.daysSinceLastOrder !== null && r.daysSinceLastOrder >= 182) {
        inactiveHalfYear++;
        lostSalesInactive += r.avgOrderSize;
      }

      if (r.daysSinceLastOrder !== null && r.usualOrderGap > 0) {
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
        if (r.daysSinceLastOrder !== null && r.daysSinceLastOrder >= 182) {
          inactiveHalfYear++;
          lostSalesInactive += r.avgOrderSize;
        }
        if (r.daysSinceLastOrder !== null && r.usualOrderGap > 0 && r.daysSinceLastOrder > r.usualOrderGap && r.daysSinceLastOrder < 182) {
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

// 7.1 Upload Clients specifically from Excel (upsert or append without wiping existing database)
app.post('/api/clients/import-excel', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Please select an Excel file (.xlsx or .xls) to upload.' });
    }

    const filePath = req.file.path;
    const wb = xlsx.readFile(filePath, { cellDates: true });
    
    // Look for 'Client Master', 'Clients', 'Customers', or default to first sheet
    let sheetName = wb.SheetNames.find(s => s.toLowerCase().includes('client') || s.toLowerCase().includes('customer')) || wb.SheetNames[0];
    const rawRows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });

    if (!rawRows || rawRows.length < 2) {
      return res.status(400).json({ success: false, error: 'Excel sheet appears empty or missing data rows.' });
    }

    // Find header index row (either row 0, 1, or 2)
    let headerIdx = 0;
    for (let r = 0; r < Math.min(rawRows.length, 5); r++) {
      const rowStr = (rawRows[r] || []).map(c => String(c || '').toLowerCase()).join(' ');
      if (rowStr.includes('client') || rowStr.includes('name') || rowStr.includes('customer')) {
        headerIdx = r;
        break;
      }
    }

    const headers = (rawRows[headerIdx] || []).map(h => String(h || '').toLowerCase().trim());
    const nameCol = headers.findIndex(h => h.includes('client name') || h.includes('client') || h.includes('customer') || h.includes('name'));
    const phoneCol = headers.findIndex(h => h.includes('contact') || h.includes('phone') || h.includes('mobile'));
    const addrCol = headers.findIndex(h => h.includes('address') || h.includes('city') || h.includes('location'));
    const gapCol = headers.findIndex(h => h.includes('gap') || h.includes('usual'));
    const dateCol = headers.findIndex(h => h.includes('first order') || h.includes('date'));
    const uidCol = headers.findIndex(h => h.includes('unique') || h.includes('id'));
    const creCol = headers.findIndex(h => h.includes('follow') || h.includes('cre') || h.includes('executive') || h.includes('doer'));

    if (nameCol === -1) {
      return res.status(400).json({ success: false, error: 'Could not find "Client Name" or "Name" column in Excel sheet header.' });
    }

    let addedCount = 0;
    let updatedCount = 0;
    const clientTotal = await Client.countDocuments();

    for (let i = headerIdx + 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      if (!row || !row[nameCol] || String(row[nameCol]).trim() === '') continue;

      const clientName = String(row[nameCol]).trim();
      const contactNumber = phoneCol !== -1 && row[phoneCol] ? String(row[phoneCol]).trim() : '';
      const address = addrCol !== -1 && row[addrCol] ? String(row[addrCol]).trim() : '';
      const usualOrderGap = gapCol !== -1 ? cleanNumber(row[gapCol]) : 0;
      const firstOrderDate = dateCol !== -1 ? parseDate(row[dateCol]) : null;
      const uniqueId = uidCol !== -1 && row[uidCol] ? String(row[uidCol]).trim() : `Scot${String(clientTotal + addedCount + 1).padStart(4, '0')}`;
      const followUpTakenBy = creCol !== -1 && row[creCol] ? String(row[creCol]).trim() : '';

      const normalized = clientName.toLowerCase().replace(/\s+/g, ' ');
      const existing = await Client.findOne({
        $or: [
          { normalizedName: normalized },
          { clientName: { $regex: `^${clientName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }
        ]
      });

      if (existing) {
        if (contactNumber && !existing.contactNumber) existing.contactNumber = contactNumber;
        if (address && !existing.address) existing.address = address;
        if (usualOrderGap && !existing.usualOrderGap) existing.usualOrderGap = usualOrderGap;
        if (firstOrderDate && !existing.firstOrderDate) existing.firstOrderDate = firstOrderDate;
        if (followUpTakenBy && !existing.followUpTakenBy) existing.followUpTakenBy = followUpTakenBy;
        
        // If this contact number isn't in company's contacts list, append it
        if (contactNumber && Array.isArray(existing.contacts)) {
          const hasPhone = existing.contacts.some(c => c.phone === contactNumber);
          if (!hasPhone) {
            existing.contacts.push({
              name: 'Staff Contact',
              designation: 'Staff',
              phone: contactNumber,
              email: ''
            });
          }
        }
        await existing.save();
        updatedCount++;
      } else {
        const initialContacts = [];
        if (contactNumber) {
          initialContacts.push({
            name: 'Primary Contact',
            designation: 'Contact Person',
            phone: contactNumber,
            email: '',
            isPrimary: true
          });
        }
        await Client.create({
          uniqueId,
          clientName,
          normalizedName: normalized,
          contactNumber,
          contacts: initialContacts,
          address,
          usualOrderGap,
          firstOrderDate,
          followUpTakenBy
        });
        addedCount++;
      }
    }

    // Clean up uploaded file
    try { fs.unlinkSync(filePath); } catch (e) {}

    res.json({
      success: true,
      message: `Excel processed successfully! Added ${addedCount} new customer(s), updated ${updatedCount} existing customer(s).`,
      added: addedCount,
      updated: updatedCount
    });
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

    // Also record a log entry in FollowUp collection for audit trail & month tracking
    const followUpLog = await FollowUp.create({
      clientId: client._id,
      clientName: client.clientName,
      contactNumber: client.contactNumber,
      callDate: followUpStatus === 'Taken / Done' ? new Date() : new Date(),
      creName: client.followUpTakenBy || 'CRE Executive',
      callStatus: followUpStatus === 'Taken / Done' ? 'Connected' : 'Call Back Requested',
      customerFeedback: client.lastFeedback || (followUpStatus === 'Taken / Done' ? 'Follow-up taken and completed.' : 'Follow-up scheduled.'),
      nextFollowUpDate: client.nextFollowUpDate,
      isCompleted: followUpStatus === 'Taken / Done'
    });

    res.json({ success: true, client, followUp: followUpLog });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9.1 Client Follow-up History Audit Trail API
app.get('/api/clients/:id/followup-history', async (req, res) => {
  try {
    const client = await Client.findById(req.params.id).lean();
    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    const history = await FollowUp.find({
      $or: [
        { clientId: client._id },
        { clientName: client.clientName }
      ]
    }).sort({ callDate: -1, createdAt: -1 }).lean();

    res.json({
      success: true,
      client: {
        _id: client._id,
        uniqueId: client.uniqueId,
        clientName: client.clientName,
        contactNumber: client.contactNumber,
        address: client.address
      },
      count: history.length,
      history
    });
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

    // 1. Check if user provided a Google Apps Script Webhook URL (used for 2-way sync)
    // 2. Normal Google Sheet URL or Publish link
    let exportUrl = sheetUrl.trim();
    
    // Check if it's a published link (e.g. /d/e/2PACX-... or pub?output=csv)
    if (exportUrl.includes('/pubhtml')) {
      exportUrl = exportUrl.replace('/pubhtml', '/pub?output=csv');
    } else if (exportUrl.includes('/d/e/')) {
      if (!exportUrl.includes('output=csv')) {
        exportUrl += (exportUrl.includes('?') ? '&' : '?') + 'output=csv';
      }
    } else {
      // Standard Google Sheet URL format:
      // Example: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit...
      const sheetMatch = exportUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (sheetMatch && sheetMatch[1] && sheetMatch[1] !== 'e') {
        const sheetId = sheetMatch[1];
        const gidMatch = exportUrl.match(/[#&]gid=([0-9]+)/);
        const gidParam = gidMatch && gidMatch[1] ? `&gid=${gidMatch[1]}` : '';
        exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gidParam}`;
      }
    }

    console.log(`Connecting and fetching Google Sheet from: ${exportUrl}`);
    const fetchResponse = await fetch(exportUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (!fetchResponse.ok) {
      throw new Error(`Google Sheet fetch error (${fetchResponse.status} ${fetchResponse.statusText}). Agar aapne "Publish to web" kiya hai to browser tab me spreadsheet ka normal Share link ("https://docs.google.com/spreadsheets/d/.../edit") copy karke paste karein aur ensure karein sharing "Anyone with the link can view" ho.`);
    }

    const csvText = await fetchResponse.text();
    if (!csvText || !csvText.trim()) {
      return res.status(400).json({ 
        success: false, 
        error: 'Google Sheet completely blank/empty hai! Spreadsheet me kam se kam row 1 par headers (jaise Client Name, Contact, Address, etc.) aur kuch data rows daalein, fir sync karein.' 
      });
    }

    const workbook = xlsx.read(csvText, { type: 'string' });
    const sheetName = workbook.SheetNames[0];
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

    if (!rows || rows.length === 0 || (rows.length === 1 && rows[0].length === 0)) {
      return res.status(400).json({ success: false, error: 'Google Sheet is empty. Please add column headers and rows in your sheet.' });
    }

    if (rows.length < 2) {
      return res.status(400).json({ success: false, error: 'Google Sheet me sirf 1 header row mili, koi data rows nahi hain. Please Google Sheet me records add karein.' });
    }

    // Determine data type by examining headers
    const headerRow = rows[0].map(h => String(h || '').toLowerCase().trim());
    let importedClients = 0;
    let importedTransactions = 0;
    let importedFollowups = 0;

    const isTxSheet = headerRow.some(h => h.includes('invoice') || (h.includes('amount') && !h.includes('follow')));
    const isFollowupSheet = headerRow.some(h => h.includes('follow') || h.includes('cre') || h.includes('doer') || h.includes('remark'));
    const isClientSheet = headerRow.some(h => h.includes('client') || h.includes('customer') || h.includes('vendor') || h.includes('name'));

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
      // Import as Clients / Vendors & FollowUps if applicable
      const nameIdx = headerRow.findIndex(h => h.includes('name') || h.includes('client') || h.includes('customer') || h.includes('vendor'));
      const typeIdx = headerRow.findIndex(h => h.includes('type') || h.includes('category'));
      const contactIdx = headerRow.findIndex(h => h.includes('contact') || h.includes('phone') || h.includes('mobile'));
      const addrIdx = headerRow.findIndex(h => h.includes('address') || h.includes('location') || h.includes('city'));
      const gapIdx = headerRow.findIndex(h => h.includes('gap') || h.includes('usual'));
      const creIdx = headerRow.findIndex(h => h.includes('cre') || h.includes('doer') || h.includes('executive') || h.includes('assign'));
      const statusIdx = headerRow.findIndex(h => h.includes('status'));
      const remarksIdx = headerRow.findIndex(h => h.includes('remark') || h.includes('note') || h.includes('comment'));

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[nameIdx]) continue;
        const cName = String(row[nameIdx]).trim();
        if (!cName) continue;

        const contact = contactIdx !== -1 && row[contactIdx] ? String(row[contactIdx]).trim() : '';
        const address = addrIdx !== -1 && row[addrIdx] ? String(row[addrIdx]).trim() : '';
        const gap = gapIdx !== -1 ? cleanNumber(row[gapIdx]) : 0;
        let cType = 'Client';
        if (typeIdx !== -1 && row[typeIdx]) {
          const tVal = String(row[typeIdx]).toLowerCase();
          if (tVal.includes('vendor') || tVal.includes('supplier')) {
            cType = 'Vendor';
          }
        }
        const cre = creIdx !== -1 && row[creIdx] ? String(row[creIdx]).trim() : '';
        const status = statusIdx !== -1 && row[statusIdx] ? String(row[statusIdx]).trim() : 'Pending';
        const remarks = remarksIdx !== -1 && row[remarksIdx] ? String(row[remarksIdx]).trim() : '';

        const savedClient = await Client.findOneAndUpdate(
          { clientName: { $regex: `^${cName}$`, $options: 'i' } },
          {
            $setOnInsert: {
              uniqueId: `Scot${String(Date.now()).slice(-4)}${i}`
            },
            clientName: cName,
            clientType: cType,
            contactNumber: contact,
            address,
            usualOrderGap: gap,
            assignedExecutive: cre || 'CRE Executive',
            followUpStatus: status || 'Pending',
            lastFeedback: remarks || ''
          },
          { upsert: true, new: true }
        );
        importedClients++;

        // Also create a Follow-up record if this row includes remarks or CRE
        if (isFollowupSheet || cre || remarks) {
          await FollowUp.create({
            clientId: savedClient._id,
            clientName: cName,
            contactNumber: contact || '',
            creName: cre || 'CRE Executive',
            callDate: new Date(),
            callStatus: status && status !== 'Pending' ? status : 'Connected',
            customerFeedback: remarks || 'Imported from Google Sheet sync',
            isCompleted: false
          });
          importedFollowups++;
        }
      }
    }

    res.json({
      success: true,
      message: `Google Sheet synced successfully! Processed ${rows.length - 1} rows (${importedClients} clients/vendors, ${importedTransactions} transactions, ${importedFollowups} follow-ups synced).`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 11. CRE / DOER MANAGEMENT API ==================== //
// Get all executives (with counts of assigned follow-ups)
app.get('/api/executives', async (req, res) => {
  try {
    let execs = await Executive.find().sort({ name: 1 }).lean();

    // Auto-seed default executives if collection is empty
    if (execs.length === 0) {
      const distinctNames = await FollowUp.distinct('creName');
      const seedNames = distinctNames.filter(Boolean).length > 0
        ? distinctNames.filter(Boolean)
        : ['CRE Executive', 'Rajesh Sharma', 'Priya Patel', 'Amit Verma', 'Sunil Kumar'];

      const toInsert = seedNames.map(name => ({
        name: name.trim(),
        role: 'CRE / Doer',
        isActive: true
      }));

      for (const item of toInsert) {
        await Executive.findOneAndUpdate({ name: item.name }, item, { upsert: true });
      }
      execs = await Executive.find().sort({ name: 1 }).lean();
    }

    // Attach active assignment count for each executive
    const withCounts = await Promise.all(
      execs.map(async (ex) => {
        const assignedCount = await FollowUp.countDocuments({
          creName: ex.name,
          isCompleted: { $ne: true }
        });
        const totalFollowUps = await FollowUp.countDocuments({ creName: ex.name });
        return {
          ...ex,
          assignedCount,
          totalFollowUps
        };
      })
    );

    res.json({ success: true, executives: withCounts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create new executive
app.post('/api/executives', async (req, res) => {
  try {
    const { name, email, phone, role } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Executive name is required' });
    }

    const existing = await Executive.findOne({ name: { $regex: `^${name.trim()}$`, $options: 'i' } });
    if (existing) {
      return res.status(400).json({ success: false, error: 'A CRE / Doer with this name already exists' });
    }

    const executive = await Executive.create({
      name: name.trim(),
      email: email ? email.trim() : '',
      phone: phone ? phone.trim() : '',
      role: role || 'CRE / Doer',
      isActive: true
    });

    res.json({ success: true, executive });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update executive
app.put('/api/executives/:id', async (req, res) => {
  try {
    const { name, email, phone, role, isActive } = req.body;
    const ex = await Executive.findById(req.params.id);
    if (!ex) {
      return res.status(404).json({ success: false, error: 'Executive not found' });
    }

    const oldName = ex.name;
    if (name && name.trim() && name.trim() !== oldName) {
      const trimmed = name.trim();
      await FollowUp.updateMany({ creName: oldName }, { creName: trimmed });
      await Client.updateMany({ followUpTakenBy: oldName }, { followUpTakenBy: trimmed });
      ex.name = trimmed;
    }

    if (email !== undefined) ex.email = email.trim();
    if (phone !== undefined) ex.phone = phone.trim();
    if (role !== undefined) ex.role = role.trim();
    if (isActive !== undefined) ex.isActive = Boolean(isActive);

    await ex.save();
    res.json({ success: true, executive: ex });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Toggle active / inactive status
app.patch('/api/executives/:id/status', async (req, res) => {
  try {
    const { isActive } = req.body;
    const ex = await Executive.findByIdAndUpdate(
      req.params.id,
      { isActive: Boolean(isActive) },
      { new: true }
    );
    if (!ex) return res.status(404).json({ success: false, error: 'Executive not found' });
    res.json({ success: true, executive: ex });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Safe Delete / Remove check
app.delete('/api/executives/:id', async (req, res) => {
  try {
    const ex = await Executive.findById(req.params.id);
    if (!ex) {
      return res.status(404).json({ success: false, error: 'Executive not found' });
    }

    const assignedFollowUps = await FollowUp.countDocuments({
      creName: ex.name,
      isCompleted: { $ne: true }
    });

    if (assignedFollowUps > 0) {
      return res.status(400).json({
        success: false,
        error: `This CRE is assigned to ${assignedFollowUps} active client follow-ups. Please reassign those records before removing, or deactivate this user instead.`,
        assignedCount: assignedFollowUps
      });
    }

    await Executive.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'CRE / Doer removed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reassign all active followups from one CRE to another
app.post('/api/executives/reassign', async (req, res) => {
  try {
    const { fromExecutive, toExecutive, deactivateFrom } = req.body;
    if (!fromExecutive || !toExecutive) {
      return res.status(400).json({ success: false, error: 'Source and Target CRE names are required' });
    }

    const updatedFollowups = await FollowUp.updateMany(
      { creName: fromExecutive, isCompleted: { $ne: true } },
      { creName: toExecutive }
    );

    const updatedClients = await Client.updateMany(
      { followUpTakenBy: fromExecutive },
      { followUpTakenBy: toExecutive }
    );

    if (deactivateFrom) {
      await Executive.findOneAndUpdate({ name: fromExecutive }, { isActive: false });
    }

    res.json({
      success: true,
      message: `Reassigned records from ${fromExecutive} to ${toExecutive} successfully`,
      followUpsModified: updatedFollowups.modifiedCount,
      clientsModified: updatedClients.modifiedCount
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

    // Auto-seed actionable Follow-up tasks for Today/Overdue/Tomorrow if FollowUp collection is empty
    const fuCount = await FollowUp.countDocuments();
    if (fuCount === 0) {
      console.log('📞 Seeding initial actionable Follow-up Agenda tasks for CRE...');
      const sampleClients = await Client.find({ contactNumber: { $ne: '' } }).limit(25).lean();
      const defaultCREs = ['Priya Patel', 'Rajesh Sharma', 'Amit Verma', 'Sunil Kumar'];
      const now = new Date();

      const seedFollowUps = sampleClients.map((c, idx) => {
        const assignedCRE = defaultCREs[idx % defaultCREs.length];
        // Spread dates: first 8 are Today, next 5 Overdue (yesterday), next 5 Tomorrow, rest general
        const targetDate = new Date(now);
        let feedback = 'Follow up regarding repeat order and catalog updates';
        let sentiment = 'Neutral';

        if (idx < 8) {
          // Today
          targetDate.setHours(10 + (idx % 6), 0, 0, 0);
          feedback = 'Customer requested call today to finalize order quantity';
          sentiment = 'Positive';
        } else if (idx < 14) {
          // Overdue (1 to 2 days ago)
          targetDate.setDate(targetDate.getDate() - (1 + (idx % 2)));
          targetDate.setHours(11, 0, 0, 0);
          feedback = 'Pending discussion on pricing discount and payment terms';
          sentiment = 'Neutral';
        } else if (idx < 20) {
          // Tomorrow
          targetDate.setDate(targetDate.getDate() + 1);
          targetDate.setHours(14, 0, 0, 0);
          feedback = 'Promised order next day after stock check with warehouse';
          sentiment = 'Positive';
        } else {
          targetDate.setDate(targetDate.getDate() + 3);
          feedback = 'Routine quarterly review and catalogue dispatch';
          sentiment = 'Neutral';
        }

        return {
          clientId: c._id,
          clientName: c.clientName,
          contactNumber: c.contactNumber || '9829461116',
          callDate: new Date(),
          creName: assignedCRE,
          callStatus: 'Connected',
          customerFeedback: feedback,
          nextFollowUpDate: targetDate,
          orderExpectedAmount: 25000 + (idx * 5000),
          sentiment,
          isCompleted: false
        };
      });

      if (seedFollowUps.length > 0) {
        await FollowUp.insertMany(seedFollowUps);
        console.log(`✅ Auto-seeded ${seedFollowUps.length} actionable follow-ups for Today's CRM Agenda.`);
      }

      // Also ensure executives are created
      for (const name of defaultCREs) {
        await Executive.findOneAndUpdate(
          { name },
          { name, role: 'CRE / Doer', isActive: true },
          { upsert: true }
        );
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
