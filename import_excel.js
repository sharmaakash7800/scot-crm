const xlsx = require('xlsx');
const mongoose = require('mongoose');
const Client = require('./models/Client');
const Transaction = require('./models/Transaction');
const Enquiry = require('./models/Enquiry');

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'number') {
    // Excel serial date to JS Date
    const utcDays = Math.floor(val - 25569);
    const utcValue = utcDays * 86400;
    const dateInfo = new Date(utcValue * 1000);
    return isNaN(dateInfo.getTime()) ? null : dateInfo;
  }
  if (typeof val === 'string') {
    const d = new Date(val.trim());
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function cleanNumber(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const cleaned = String(val).replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

async function importExcelData(filePath) {
  console.log(`Starting Excel data import from: ${filePath}`);
  const wb = xlsx.readFile(filePath, { cellDates: true });

  // 1. Client Master
  if (wb.Sheets['Client Master']) {
    const rawClients = xlsx.utils.sheet_to_json(wb.Sheets['Client Master'], { header: 1 });
    // Row 1 is title, Row 2 is headers: ['Client Name', 'Contact Number', 'Address', 'Usual Order Gap (days)', 'First Order Date', 'Unique Id']
    const clientsToInsert = [];
    for (let i = 2; i < rawClients.length; i++) {
      const row = rawClients[i];
      if (!row || !row[0] || String(row[0]).trim() === '') continue;
      const clientName = String(row[0]).trim();
      const contactNumber = row[1] ? String(row[1]).trim() : '';
      const address = row[2] ? String(row[2]).trim() : '';
      const usualOrderGap = cleanNumber(row[3]);
      const firstOrderDate = parseDate(row[4]);
      const uniqueId = row[5] ? String(row[5]).trim() : `Scot${String(i - 1).padStart(4, '0')}`;

      clientsToInsert.push({
        uniqueId,
        clientName,
        contactNumber,
        address,
        usualOrderGap,
        firstOrderDate
      });
    }

    if (clientsToInsert.length > 0) {
      await Client.deleteMany({});
      await Client.insertMany(clientsToInsert);
      console.log(`✅ Seeded ${clientsToInsert.length} clients into Client Master.`);
    }
  }

  // 2. Transaction Log
  if (wb.Sheets['Transaction Log']) {
    const rawTx = xlsx.utils.sheet_to_json(wb.Sheets['Transaction Log'], { header: 1 });
    // Row 1 is title, Row 2 is headers: ['Date', 'Client Name', 'Invoice No.', 'Amount', 'Total Invoice']
    const txToInsert = [];
    for (let i = 2; i < rawTx.length; i++) {
      const row = rawTx[i];
      if (!row || (!row[0] && !row[1])) continue;
      const date = parseDate(row[0]);
      const clientName = row[1] ? String(row[1]).trim() : '';
      if (!clientName) continue;
      const invoiceNo = row[2] ? String(row[2]).trim() : '';
      const amount = cleanNumber(row[3]);

      txToInsert.push({
        date: date || new Date(),
        clientName,
        invoiceNo,
        amount
      });
    }

    if (txToInsert.length > 0) {
      await Transaction.deleteMany({});
      await Transaction.insertMany(txToInsert);
      console.log(`✅ Seeded ${txToInsert.length} transactions into Transaction Log.`);
    }
  }

  // 3. Enquiry Capture Sheet
  if (wb.Sheets['Enq Capture Sheet']) {
    const rawEnq = xlsx.utils.sheet_to_json(wb.Sheets['Enq Capture Sheet'], { header: 1 });
    // Row 1 is title, Row 2 is empty/notes, Row 3 is headers: ['Month', 'Total Orders / Enquiries', 'Orders that did NOT get Follow-up', 'Total Value of those Orders (Rs)', '% Not Followed Up']
    const enqToInsert = [];
    for (let i = 3; i < rawEnq.length; i++) {
      const row = rawEnq[i];
      if (!row || !row[0] || String(row[0]).trim() === '') continue;
      const monthKey = String(row[0]).trim();
      const totalOrdersOrEnquiries = cleanNumber(row[1]);
      const ordersNotFollowedUp = cleanNumber(row[2]);
      const totalValueOfOrders = cleanNumber(row[3]);
      const notFollowedPercentage = totalOrdersOrEnquiries > 0
        ? (ordersNotFollowedUp / totalOrdersOrEnquiries)
        : cleanNumber(row[4]);

      enqToInsert.push({
        monthKey,
        monthIndex: i - 3,
        year: 2026,
        totalOrdersOrEnquiries,
        ordersNotFollowedUp,
        totalValueOfOrders,
        notFollowedPercentage
      });
    }

    if (enqToInsert.length > 0) {
      await Enquiry.deleteMany({});
      await Enquiry.insertMany(enqToInsert);
      console.log(`✅ Seeded ${enqToInsert.length} monthly enquiry records.`);
    }
  }

  console.log('🎉 Excel import completed successfully!');
}

module.exports = { importExcelData, parseDate, cleanNumber };
