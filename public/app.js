// State variables
let currentMonthKey = "Apr'26";
let currentMonthsList = [];
let salesChart = null;
let healthChart = null;

// Helpers
function formatCurrency(num) {
  if (num === null || num === undefined || isNaN(num)) return '₹0';
  return '₹' + Math.round(num).toLocaleString('en-IN');
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  return d.toISOString().split('T')[0];
}

function getStatusBadge(status) {
  if (!status) return '<span class="badge badge-none">-</span>';
  if (status.startsWith('Active')) return `<span class="badge badge-active">🟢 ${status}</span>`;
  if (status.startsWith('Slow')) return `<span class="badge badge-slow">🟡 ${status}</span>`;
  if (status.startsWith('At Risk')) return `<span class="badge badge-risk">🟠 ${status}</span>`;
  if (status.startsWith('Inactive')) return `<span class="badge badge-inactive">🔴 ${status}</span>`;
  return `<span class="badge badge-none">⚪ ${status}</span>`;
}

// Navigation & Tab Switching
function switchTab(tabId) {
  document.querySelectorAll('.nav-link').forEach(link => {
    if (link.getAttribute('data-tab') === tabId) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  document.querySelectorAll('.tab-content').forEach(tab => {
    if (tab.id === `tab-${tabId}`) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  // Load specific tab data
  if (tabId === 'dashboard') loadDashboard();
  if (tabId === 'scot-monthly') loadScotMonthly();
  if (tabId === 'monthly-loss') loadMonthlyLossMatrix();
  if (tabId === 'clients') loadClientMaster();
  if (tabId === 'transactions') loadTransactions();
  if (tabId === 'enquiries') loadEnquiries();
}

// Month Selector Rendering
function renderMonthPills(months) {
  currentMonthsList = months;
  const container = document.getElementById('monthFilterContainer');
  if (!container) return;
  container.innerHTML = '';

  months.forEach(m => {
    const pill = document.createElement('button');
    pill.className = `month-pill ${m.key === currentMonthKey ? 'active' : ''}`;
    pill.innerText = m.name;
    pill.onclick = () => {
      currentMonthKey = m.key;
      document.querySelectorAll('.month-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      loadDashboard();
      if (document.getElementById('tab-scot-monthly').classList.contains('active')) {
        loadScotMonthly();
      }
    };
    container.appendChild(pill);
  });
}

// 1. Dashboard Loader
async function loadDashboard() {
  try {
    const resStats = await fetch('/api/stats');
    const dataStats = await resStats.json();

    if (dataStats.months && (!currentMonthsList || currentMonthsList.length === 0)) {
      renderMonthPills(dataStats.months);
    }

    // Fetch month specific data
    const resMonth = await fetch(`/api/scot-month/${encodeURIComponent(currentMonthKey)}`);
    const dataMonth = await resMonth.json();
    const sum = dataMonth.summary || {};

    document.getElementById('kpiTotalClients').innerText = sum.totalClients || dataStats.totalClients || 0;
    document.getElementById('kpiTotalSales').innerText = formatCurrency(sum.totalSalesThisCutoff || 0);
    document.getElementById('kpiInactiveClients').innerText = sum.inactiveHalfYear || 0;
    document.getElementById('kpiInactiveLostSale').innerText = `Lost Sale: ${formatCurrency(sum.lostSalesInactive || 0)}`;
    document.getElementById('kpiIrregularClients').innerText = sum.irregularClients || 0;
    document.getElementById('kpiIrregularLostSale').innerText = `Lost Sale: ${formatCurrency(sum.lostSalesIrregular || 0)}`;

    // Render Priority Table (Clients requiring urgent attention)
    const records = dataMonth.records || [];
    const priorityList = records
      .filter(r => r.status.includes('Inactive') || r.status.includes('At Risk') || (r.usualOrderGap > 0 && r.daysSinceLastOrder > r.usualOrderGap))
      .slice(0, 10);

    const tbody = document.querySelector('#dashboardPriorityTable tbody');
    if (priorityList.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No urgent follow-ups for this period.</td></tr>';
    } else {
      tbody.innerHTML = priorityList.map(r => `
        <tr>
          <td><strong>${r.clientName}</strong></td>
          <td>${r.contactNumber || '-'}</td>
          <td><span style="font-weight: 600; color: ${r.daysSinceLastOrder >= 182 ? '#fb7185' : '#fbbf24'}">${r.daysSinceLastOrder === 9999 ? 'Never' : r.daysSinceLastOrder + ' days'}</span></td>
          <td>${formatDate(r.lastOrderDate)}</td>
          <td>${formatCurrency(r.lastOrderAmount)}</td>
          <td>${getStatusBadge(r.status)}</td>
        </tr>
      `).join('');
    }

    // Health Chart Doughnut
    renderHealthChart(sum);
    // Load full loss trend chart
    loadTrendCharts();
  } catch (err) {
    console.error('Error loading dashboard:', err);
  }
}

function renderHealthChart(summary) {
  const ctx = document.getElementById('clientHealthChart');
  if (!ctx) return;

  const data = [
    summary.activeClients || 0,
    summary.slowClients || 0,
    summary.atRiskClients || 0,
    summary.inactiveHalfYear || 0,
    summary.noOrdersYet || 0
  ];

  if (healthChart) {
    healthChart.destroy();
  }

  healthChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Active (0-30d)', 'Slow (31-90d)', 'At Risk (91-181d)', 'Inactive (6m+)', 'No Orders'],
      datasets: [{
        data: data,
        backgroundColor: [
          '#10b981',
          '#f59e0b',
          '#f97316',
          '#f43f5e',
          '#64748b'
        ],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 } }
        }
      },
      cutout: '70%'
    }
  });
}

async function loadTrendCharts() {
  try {
    const res = await fetch('/api/monthly-loss-matrix');
    const data = await res.json();
    const matrix = data.matrix || [];

    const labels = matrix.map(m => m.monthKey);
    const salesData = matrix.map(m => m.totalSales);
    const irregularLostData = matrix.map(m => m.lostSalesIrregular);

    const ctx = document.getElementById('salesTrendChart');
    if (!ctx) return;

    if (salesChart) {
      salesChart.destroy();
    }

    salesChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Cumulative Sales (₹)',
            data: salesData,
            backgroundColor: 'rgba(99, 102, 241, 0.7)',
            borderRadius: 6
          },
          {
            label: 'Lost Sales (Irregular Clients ₹)',
            data: irregularLostData,
            backgroundColor: 'rgba(244, 63, 94, 0.7)',
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { color: '#94a3b8', font: { family: 'Inter' } }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#94a3b8' }
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: {
              color: '#94a3b8',
              callback: val => '₹' + (val / 100000).toFixed(1) + 'L'
            }
          }
        }
      }
    });
  } catch (err) {
    console.error('Failed to load chart trends:', err);
  }
}

// 2. Monthly SCOT Sheet View
let currentScotRecords = [];

async function loadScotMonthly() {
  try {
    document.getElementById('scotSheetTitle').innerText = `Monthly SCOT Sheet: ${currentMonthKey}`;
    const tbody = document.querySelector('#scotSheetTable tbody');
    tbody.innerHTML = '<tr><td colspan="11" style="text-align: center;">Calculating live SCOT metrics...</td></tr>';

    const res = await fetch(`/api/scot-month/${encodeURIComponent(currentMonthKey)}`);
    const data = await res.json();
    currentScotRecords = data.records || [];
    renderScotTable(currentScotRecords);
  } catch (err) {
    console.error('Error loading SCOT sheet:', err);
  }
}

function renderScotTable(records) {
  const tbody = document.querySelector('#scotSheetTable tbody');
  if (records.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; color: var(--text-muted);">No records found.</td></tr>';
    return;
  }

  tbody.innerHTML = records.map(r => `
    <tr>
      <td><strong>${r.clientName}</strong></td>
      <td>${r.contactNumber || '-'}</td>
      <td>${formatDate(r.firstOrderDate)}</td>
      <td>${formatDate(r.lastOrderDate)}</td>
      <td><span style="font-weight: 600;">${r.daysSinceLastOrder === 9999 ? '9999' : r.daysSinceLastOrder}</span></td>
      <td>${r.lastInvoiceNo || '-'}</td>
      <td>${formatCurrency(r.lastOrderAmount)}</td>
      <td>${r.totalInvoices}</td>
      <td><strong>${formatCurrency(r.totalSales)}</strong></td>
      <td>${getStatusBadge(r.status)}</td>
      <td>${formatCurrency(r.avgOrderSize)}</td>
    </tr>
  `).join('');
}

// Filter SCOT table
document.getElementById('scotSearch')?.addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  const filtered = currentScotRecords.filter(r => 
    r.clientName.toLowerCase().includes(q) || 
    (r.contactNumber && r.contactNumber.includes(q))
  );
  renderScotTable(filtered);
});

// 3. Monthly Loss Matrix View
async function loadMonthlyLossMatrix() {
  try {
    const res = await fetch('/api/monthly-loss-matrix');
    const data = await res.json();
    const matrix = data.matrix || [];

    const tbody = document.querySelector('#lossMatrixTable tbody');
    
    // Row 1: % of Orders that do not get follow-up (Leaking Bucket)
    let r1 = '<tr><td><strong>% Orders without Follow-Up</strong></td>' +
      matrix.map(m => `<td>${(m.enqDropRate * 100).toFixed(1)}%</td>`).join('') + '</tr>';

    // Row 2: Lost value of un-followed orders
    let r2 = '<tr><td><strong>Value of Un-followed Enquiries</strong></td>' +
      matrix.map(m => `<td>${formatCurrency(m.enqLostValue)}</td>`).join('') + '</tr>';

    // Row 3: Irregular Clients Count
    let r3 = '<tr><td><strong>Clients Not Ordering Regularly</strong></td>' +
      matrix.map(m => `<td>${m.irregularClients}</td>`).join('') + '</tr>';

    // Row 4: % Irregular Clients
    let r4 = '<tr><td><strong>% Irregular Clients</strong></td>' +
      matrix.map(m => `<td>${(m.pctIrregular * 100).toFixed(1)}%</td>`).join('') + '</tr>';

    // Row 5: Lost sales of irregular clients
    let r5 = '<tr><td><strong style="color: #fb7185;">Lost Sale of Irregular Clients</strong></td>' +
      matrix.map(m => `<td style="color: #fb7185;">${formatCurrency(m.lostSalesIrregular)}</td>`).join('') + '</tr>';

    // Row 6: Inactive (6+ months) count
    let r6 = '<tr><td><strong>Clients Inactive 1/2 Year</strong></td>' +
      matrix.map(m => `<td>${m.inactiveHalfYear}</td>`).join('') + '</tr>';

    // Row 7: % Inactive
    let r7 = '<tr><td><strong>% Clients Inactive 1/2 Year</strong></td>' +
      matrix.map(m => `<td>${(m.pctInactive * 100).toFixed(1)}%</td>`).join('') + '</tr>';

    // Row 8: Lost Sales Inactive
    let r8 = '<tr><td><strong style="color: #fb7185;">Lost Sale Inactive 1/2 Year</strong></td>' +
      matrix.map(m => `<td style="color: #fb7185;">${formatCurrency(m.lostSalesInactive)}</td>`).join('') + '</tr>';

    tbody.innerHTML = r1 + r2 + r3 + r4 + r5 + r6 + r7 + r8;
  } catch (err) {
    console.error('Error loading Loss matrix:', err);
  }
}

// 4. Client Master View
async function loadClientMaster() {
  try {
    const q = document.getElementById('clientMasterSearch')?.value || '';
    const res = await fetch(`/api/clients?search=${encodeURIComponent(q)}`);
    const data = await res.json();
    const clients = data.clients || [];

    const tbody = document.querySelector('#clientMasterTable tbody');
    if (clients.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No clients found.</td></tr>';
      return;
    }

    tbody.innerHTML = clients.map(c => `
      <tr>
        <td><code>${c.uniqueId || '-'}</code></td>
        <td><strong>${c.clientName}</strong></td>
        <td>${c.contactNumber || '-'}</td>
        <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis;">${c.address || '-'}</td>
        <td>${c.usualOrderGap || 0} days</td>
        <td>${formatDate(c.firstOrderDate)}</td>
        <td>
          <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem;" onclick="editClient('${c._id}')">Edit</button>
          <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem; color: #fb7185;" onclick="deleteClient('${c._id}')">Delete</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading clients:', err);
  }
}

document.getElementById('clientMasterSearch')?.addEventListener('input', () => {
  loadClientMaster();
});

// 5. Transactions View
async function loadTransactions() {
  try {
    const q = document.getElementById('transactionSearch')?.value || '';
    const res = await fetch(`/api/transactions?search=${encodeURIComponent(q)}`);
    const data = await res.json();
    const txs = data.transactions || [];

    const tbody = document.querySelector('#transactionTable tbody');
    if (txs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No transactions recorded.</td></tr>';
      return;
    }

    tbody.innerHTML = txs.map(t => `
      <tr>
        <td>${formatDate(t.date)}</td>
        <td><strong>${t.clientName}</strong></td>
        <td>${t.invoiceNo || '-'}</td>
        <td><strong>${formatCurrency(t.amount)}</strong></td>
        <td>
          <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem; color: #fb7185;" onclick="deleteTransaction('${t._id}')">Delete</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading transactions:', err);
  }
}

document.getElementById('transactionSearch')?.addEventListener('input', () => {
  loadTransactions();
});

// 6. Enquiry Sheet View
async function loadEnquiries() {
  try {
    const res = await fetch('/api/enquiries');
    const data = await res.json();
    const enquiries = data.enquiries || [];

    const tbody = document.querySelector('#enquiryTable tbody');
    if (enquiries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No enquiry records found.</td></tr>';
      return;
    }

    tbody.innerHTML = enquiries.map(e => `
      <tr>
        <td><strong>${e.monthKey}</strong></td>
        <td>${e.totalOrdersOrEnquiries}</td>
        <td>${e.ordersNotFollowedUp}</td>
        <td>${formatCurrency(e.totalValueOfOrders)}</td>
        <td><span class="badge ${e.notFollowedPercentage > 0.08 ? 'badge-inactive' : 'badge-slow'}">${(e.notFollowedPercentage * 100).toFixed(1)}%</span></td>
        <td>
          <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem;" onclick="openEnquiryModal('${e.monthKey}', ${e.monthIndex}, ${e.totalOrdersOrEnquiries}, ${e.ordersNotFollowedUp}, ${e.totalValueOfOrders})">Edit</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading enquiries:', err);
  }
}

// Modal Actions
function openTxModal() {
  document.getElementById('txDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('txModal').classList.add('active');
}
function closeTxModal() {
  document.getElementById('txModal').classList.remove('active');
  document.getElementById('txForm').reset();
}

document.getElementById('txForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    clientName: document.getElementById('txClientName').value,
    date: document.getElementById('txDate').value,
    invoiceNo: document.getElementById('txInvoiceNo').value,
    amount: parseFloat(document.getElementById('txAmount').value)
  };

  const res = await fetch('/api/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.ok) {
    closeTxModal();
    loadTransactions();
    loadDashboard();
  } else {
    alert('Failed to save transaction');
  }
});

// Client Modal
function openClientModal(client = null) {
  if (client) {
    document.getElementById('clientModalTitle').innerText = 'Edit Client';
    document.getElementById('clientEditId').value = client._id;
    document.getElementById('clientName').value = client.clientName;
    document.getElementById('clientContact').value = client.contactNumber || '';
    document.getElementById('clientAddress').value = client.address || '';
    document.getElementById('clientUsualGap').value = client.usualOrderGap || '';
    document.getElementById('clientFirstOrderDate').value = client.firstOrderDate ? client.firstOrderDate.split('T')[0] : '';
  } else {
    document.getElementById('clientModalTitle').innerText = 'Add Client';
    document.getElementById('clientEditId').value = '';
    document.getElementById('clientForm').reset();
  }
  document.getElementById('clientModal').classList.add('active');
}
function closeClientModal() {
  document.getElementById('clientModal').classList.remove('active');
  document.getElementById('clientForm').reset();
}

async function editClient(id) {
  const res = await fetch(`/api/clients?search=${id}`);
  const data = await res.json();
  const c = data.clients?.find(item => item._id === id);
  if (c) openClientModal(c);
}

async function deleteClient(id) {
  if (!confirm('Are you sure you want to delete this client?')) return;
  await fetch(`/api/clients/${id}`, { method: 'DELETE' });
  loadClientMaster();
}

async function deleteTransaction(id) {
  if (!confirm('Are you sure you want to delete this transaction?')) return;
  await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
  loadTransactions();
  loadDashboard();
}

document.getElementById('clientForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('clientEditId').value;
  const body = {
    clientName: document.getElementById('clientName').value,
    contactNumber: document.getElementById('clientContact').value,
    address: document.getElementById('clientAddress').value,
    usualOrderGap: document.getElementById('clientUsualGap').value,
    firstOrderDate: document.getElementById('clientFirstOrderDate').value
  };

  const url = id ? `/api/clients/${id}` : '/api/clients';
  const method = id ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.ok) {
    closeClientModal();
    loadClientMaster();
  } else {
    alert('Failed to save client');
  }
});

// Enquiry Modal
function openEnquiryModal(monthKey, index, total, notFollowed, totalVal) {
  document.getElementById('enqMonthKey').value = monthKey;
  document.getElementById('enqMonthIndex').value = index;
  document.getElementById('enqMonthName').value = monthKey;
  document.getElementById('enqTotalOrders').value = total;
  document.getElementById('enqNotFollowed').value = notFollowed;
  document.getElementById('enqTotalValue').value = totalVal;
  document.getElementById('enquiryModal').classList.add('active');
}
function closeEnquiryModal() {
  document.getElementById('enquiryModal').classList.remove('active');
}
document.getElementById('enquiryForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    monthKey: document.getElementById('enqMonthKey').value,
    monthIndex: document.getElementById('enqMonthIndex').value,
    totalOrdersOrEnquiries: document.getElementById('enqTotalOrders').value,
    ordersNotFollowedUp: document.getElementById('enqNotFollowed').value,
    totalValueOfOrders: document.getElementById('enqTotalValue').value
  };
  const res = await fetch('/api/enquiries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.ok) {
    closeEnquiryModal();
    loadEnquiries();
    loadDashboard();
  }
});

// Dropzone & Excel Import
const dropzone = document.getElementById('dropzoneBox');
const fileInput = document.getElementById('excelFileInput');

if (dropzone && fileInput) {
  dropzone.onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    if (fileInput.files.length > 0) {
      uploadExcelFile(fileInput.files[0]);
    }
  };
  dropzone.ondragover = (e) => { e.preventDefault(); dropzone.style.borderColor = 'var(--accent-primary)'; };
  dropzone.ondragleave = () => { dropzone.style.borderColor = 'var(--border-color)'; };
  dropzone.ondrop = (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--border-color)';
    if (e.dataTransfer.files.length > 0) {
      uploadExcelFile(e.dataTransfer.files[0]);
    }
  };
}

async function uploadExcelFile(file) {
  const statusDiv = document.getElementById('importStatus');
  statusDiv.innerHTML = '<span style="color: var(--accent-cyan);">⏳ Uploading and syncing to MongoDB...</span>';
  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/import-excel', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      statusDiv.innerHTML = '<span style="color: #10b981;">✅ File imported and saved to MongoDB successfully!</span>';
      loadDashboard();
    } else {
      statusDiv.innerHTML = `<span style="color: #f43f5e;">❌ Import failed: ${data.error}</span>`;
    }
  } catch (err) {
    statusDiv.innerHTML = `<span style="color: #f43f5e;">❌ Network error: ${err.message}</span>`;
  }
}

document.getElementById('btnTriggerDefaultImport')?.addEventListener('click', async () => {
  const statusDiv = document.getElementById('importStatus');
  statusDiv.innerHTML = '<span style="color: var(--accent-cyan);">⏳ Seeding MongoDB from workspace Excel file...</span>';
  try {
    const res = await fetch('/api/import-excel', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      statusDiv.innerHTML = '<span style="color: #10b981;">✅ Synced successfully with MongoDB!</span>';
      loadDashboard();
    } else {
      statusDiv.innerHTML = `<span style="color: #f43f5e;">❌ Error: ${data.error}</span>`;
    }
  } catch (err) {
    statusDiv.innerHTML = `<span style="color: #f43f5e;">❌ Network error: ${err.message}</span>`;
  }
});

// Export Current Sheet
document.getElementById('btnExportCurrent')?.addEventListener('click', () => {
  window.open(`/api/export/scot/${encodeURIComponent(currentMonthKey)}`, '_blank');
});

// Setup Top Header buttons
document.getElementById('btnRefresh')?.addEventListener('click', () => {
  loadDashboard();
});
document.getElementById('btnNewTransaction')?.addEventListener('click', openTxModal);
document.getElementById('btnNewClient')?.addEventListener('click', () => openClientModal());

// Tab navigation listeners
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    const tab = link.getAttribute('data-tab');
    switchTab(tab);
  });
});

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
});
