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
  if (status.startsWith('Active')) return `<span class="badge badge-active"><span class="badge-dot">●</span> ${status}</span>`;
  if (status.startsWith('Slow')) return `<span class="badge badge-slow"><span class="badge-dot">●</span> ${status}</span>`;
  if (status.startsWith('At Risk')) return `<span class="badge badge-risk"><span class="badge-dot">●</span> ${status}</span>`;
  if (status.startsWith('Inactive')) return `<span class="badge badge-inactive"><span class="badge-dot">●</span> ${status}</span>`;
  return `<span class="badge badge-none"><span class="badge-dot">●</span> ${status}</span>`;
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

  // Auto-remove / close sidebar on small screens after clicking a link
  if (window.innerWidth < 1100) {
    document.body.classList.add('sidebar-collapsed');
  }

  // Load specific tab data
  if (tabId === 'dashboard') loadDashboard();
  if (tabId === 'cre-followups') loadCREFollowUps();
  if (tabId === 'calendar-view') loadFollowUpCalendar();
  if (tabId === 'scot-monthly') loadScotMonthly();
  if (tabId === 'monthly-loss') loadMonthlyLossMatrix();
  if (tabId === 'clients') loadClientMaster();
  if (tabId === 'transactions') loadTransactions();
  if (tabId === 'enquiries') loadEnquiries();
}

// Month Selector Rendering (Dropdown Only)
function renderMonthPills(months) {
  currentMonthsList = months;
  const dropdown = document.getElementById('monthSelectDropdown');
  const badge = document.getElementById('currentMonthBadge');

  if (dropdown) {
    dropdown.innerHTML = months.map(m => `
      <option value="${m.key}" ${m.key === currentMonthKey ? 'selected' : ''}>${m.name} (${m.key})</option>
    `).join('');

    dropdown.onchange = (e) => {
      selectMonth(e.target.value);
    };
  }

  if (badge) {
    const activeMonth = months.find(m => m.key === currentMonthKey);
    badge.innerText = activeMonth ? activeMonth.name : currentMonthKey;
  }
}

function selectMonth(monthKey) {
  currentMonthKey = monthKey;
  
  // Sync dropdown
  const dropdown = document.getElementById('monthSelectDropdown');
  if (dropdown) dropdown.value = monthKey;

  // Sync badge
  const badge = document.getElementById('currentMonthBadge');
  if (badge && currentMonthsList) {
    const activeMonth = currentMonthsList.find(m => m.key === monthKey);
    badge.innerText = activeMonth ? activeMonth.name : monthKey;
  }

  loadDashboard();
  if (document.getElementById('tab-scot-monthly').classList.contains('active')) {
    loadScotMonthly();
  }
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
    tbody.innerHTML = '<tr><td colspan="13" style="text-align: center; color: var(--text-muted);">No records found.</td></tr>';
    return;
  }

  tbody.innerHTML = records.map(r => {
    // Month-specific status badge
    let statusBadge = '<span class="badge badge-none">Not Planned</span>';
    if (r.followUpStatus === 'Taken / Done') {
      statusBadge = '<span class="badge badge-active">✅ Done</span>';
    } else if (r.followUpStatus === 'Pending') {
      statusBadge = '<span class="badge badge-slow">⏳ Pending</span>';
    }

    const plannedDisplay = r.plannedDate 
      ? `<strong style="color: var(--accent-cyan);">${formatDate(r.plannedDate)}</strong>` 
      : '<span style="color: var(--text-muted);">-</span>';

    const actualDisplay = r.actualDate 
      ? `<strong style="color: #10b981;">${formatDate(r.actualDate)}</strong>` 
      : '<span style="color: var(--text-muted);">-</span>';

    const remarkDisplay = r.remark 
      ? `<span style="display: block; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.82rem;" title="${r.remark.replace(/"/g, '&quot;')}">${r.remark}</span>` 
      : '<span style="color: var(--text-muted);">-</span>';

    return `
      <tr>
        <td class="col-client"><strong>${r.clientName}</strong></td>
        <td>${r.contactNumber || '-'}</td>
        <td class="col-numeric"><span style="font-weight: 600;">${r.daysSinceLastOrder === 9999 ? '9999' : r.daysSinceLastOrder}</span></td>
        <td>${formatDate(r.lastOrderDate)}</td>
        <td class="col-numeric">${r.totalInvoices}</td>
        <td class="col-numeric"><strong>${formatCurrency(r.totalSales)}</strong></td>
        <td>${getStatusBadge(r.status)}</td>
        <td>${plannedDisplay}</td>
        <td>${actualDisplay}</td>
        <td>${r.followUpTakenBy || '<span style="color: var(--text-muted);">-</span>'}</td>
        <td>${statusBadge}</td>
        <td>${remarkDisplay}</td>
        <td>
          <div style="display: flex; gap: 6px; align-items: center;">
            <button class="btn btn-secondary btn-action-sm" title="Update follow-up for this month" onclick="openQuickFollowUpModal('${r._id}', '${r.clientName.replace(/'/g, "\\'")}', '${r.plannedDate ? r.plannedDate.split('T')[0] : ''}', '${(r.followUpTakenBy || '').replace(/'/g, "\\'")}', '${r.followUpStatus || 'Pending'}', '${(r.remark || '').replace(/'/g, "\\'")}')">
              ⚡ Set
            </button>
            <button class="btn btn-secondary btn-action-sm" style="color: var(--accent-cyan);" title="View complete follow-up audit trail" onclick="viewClientHistory('${r._id}')">
              📜 History
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
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

    tbody.innerHTML = clients.map(c => {
      const isTaken = c.followUpStatus === 'Taken / Done';
      const statusBadge = isTaken
        ? '<span class="badge badge-active">✅ Done</span>'
        : (c.nextFollowUpDate ? '<span class="badge badge-slow">⏳ Pending</span>' : '<span class="badge badge-none">Not Set</span>');

      return `
        <tr>
          <td><code>${c.uniqueId || '-'}</code></td>
          <td><strong style="cursor: pointer; color: var(--accent-cyan);" onclick="editClient('${c._id}')" title="Click to Edit">${c.clientName} ✏️</strong></td>
          <td>${c.contactNumber || '-'}</td>
          <td style="max-width: 220px; overflow: hidden; text-overflow: ellipsis;">${c.address || '-'}</td>
          <td>${c.usualOrderGap || 0} days</td>
          <td><strong style="color: var(--accent-cyan);">${formatDate(c.nextFollowUpDate)}</strong></td>
          <td>${statusBadge}</td>
          <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; font-size: 0.82rem; color: var(--text-secondary);">${c.lastFeedback || '-'}</td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-primary" style="padding: 4px 8px; font-size: 0.75rem;" onclick="editClient('${c._id}')">✏️ Edit</button>
              <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.75rem; color: var(--accent-cyan);" onclick="viewClientHistory('${c._id}')">📜 History</button>
              <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.75rem; color: #fb7185;" onclick="deleteClient('${c._id}')">Delete</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
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
    document.getElementById('clientModalTitle').innerText = '✏️ Edit Client Details';
    document.getElementById('clientEditId').value = client._id;
    document.getElementById('clientName').value = client.clientName;
    document.getElementById('clientContact').value = client.contactNumber || '';
    document.getElementById('clientAddress').value = client.address || '';
    document.getElementById('clientUsualGap').value = client.usualOrderGap || '';
    document.getElementById('clientFirstOrderDate').value = client.firstOrderDate ? client.firstOrderDate.split('T')[0] : '';
    document.getElementById('clientFollowUpStatus').value = client.followUpStatus || 'Pending';
    document.getElementById('clientNextFollowUpDate').value = client.nextFollowUpDate ? client.nextFollowUpDate.split('T')[0] : '';
    document.getElementById('clientFollowUpTakenBy').value = client.followUpTakenBy || '';
    document.getElementById('clientLastFeedback').value = client.lastFeedback || '';
  } else {
    document.getElementById('clientModalTitle').innerText = 'Add New Client';
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
  loadScotMonthly();
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
    firstOrderDate: document.getElementById('clientFirstOrderDate').value,
    followUpStatus: document.getElementById('clientFollowUpStatus').value,
    nextFollowUpDate: document.getElementById('clientNextFollowUpDate').value,
    followUpTakenBy: document.getElementById('clientFollowUpTakenBy').value,
    lastFeedback: document.getElementById('clientLastFeedback').value
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
    loadScotMonthly();
    loadTodayFollowUpAgenda();
    loadFollowUpCalendar();
    alert('✅ Client data saved & updated successfully!');
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
// ==================== DAY / NIGHT MODE (THEME TOGGLE) ==================== //
function initTheme() {
  const savedTheme = localStorage.getItem('scot_theme') || 'dark';
  setTheme(savedTheme);

  document.getElementById('btnThemeToggle')?.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
  });
}

function setTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    document.getElementById('themeToggleIcon').innerText = '🌙';
    document.getElementById('themeToggleText').innerText = 'Night Mode';
  } else {
    document.documentElement.removeAttribute('data-theme');
    document.getElementById('themeToggleIcon').innerText = '☀️';
    document.getElementById('themeToggleText').innerText = 'Day Mode';
  }
  localStorage.setItem('scot_theme', theme);
}

// ==================== CRE CALL & FOLLOW-UP CRM ==================== //
let allFollowupsList = [];

async function loadCREFollowUps() {
  await Promise.all([
    loadTodayFollowUpAgenda(),
    loadAllFollowupsHistory()
  ]);
}

// State for Agenda Filters
let agendaFilterState = {
  filter: 'today', // 'today', 'tomorrow', 'overdue', 'completed', 'all'
  date: '',
  executive: 'all',
  search: ''
};

// 1. Follow-up Agenda (आज किसका Follow-up लेना है) with filter bar & live counter cards
async function loadTodayFollowUpAgenda() {
  const container = document.getElementById('todayAgendaList');
  if (!container) return;

  try {
    const params = new URLSearchParams();
    if (agendaFilterState.filter) params.append('filter', agendaFilterState.filter);
    if (agendaFilterState.date) params.append('date', agendaFilterState.date);
    if (agendaFilterState.executive && agendaFilterState.executive !== 'all') {
      params.append('executive', agendaFilterState.executive);
    }
    if (agendaFilterState.search) params.append('search', agendaFilterState.search);

    const res = await fetch(`/api/followups/today?${params.toString()}`);
    const data = await res.json();
    const list = data.followups || [];
    const counts = data.counts || {};
    const executives = data.executives || [];

    // 1. Update 6 Counter Cards
    const elPending = document.getElementById('counterValPending');
    const elDueToday = document.getElementById('counterValDueToday');
    const elDueTomorrow = document.getElementById('counterValDueTomorrow');
    const elOverdue = document.getElementById('counterValOverdue');
    const elCompleted = document.getElementById('counterValCompleted');
    const elTotal = document.getElementById('counterValTotalAssigned');

    if (elPending) elPending.innerText = counts.pending ?? 0;
    if (elDueToday) elDueToday.innerText = counts.dueToday ?? 0;
    if (elDueTomorrow) elDueTomorrow.innerText = counts.dueTomorrow ?? 0;
    if (elOverdue) elOverdue.innerText = counts.overdue ?? 0;
    if (elCompleted) elCompleted.innerText = counts.completed ?? 0;
    if (elTotal) elTotal.innerText = counts.totalAssigned ?? 0;

    // 2. Populate Responsible Person Dropdown if not yet filled
    const elExecSelect = document.getElementById('agendaResponsiblePerson');
    if (elExecSelect && elExecSelect.options.length <= 1 && executives.length > 0) {
      executives.forEach(name => {
        if (!name) return;
        const opt = document.createElement('option');
        opt.value = name;
        opt.innerText = name;
        elExecSelect.appendChild(opt);
      });
      if (agendaFilterState.executive) {
        elExecSelect.value = agendaFilterState.executive;
      }
    }

    // 3. Update Subtitle based on active filter
    const subTitle = document.getElementById('agendaSubtitle');
    if (subTitle) {
      let filterDesc = 'Scheduled calls';
      if (agendaFilterState.filter === 'today') filterDesc = 'Scheduled calls due today';
      else if (agendaFilterState.filter === 'tomorrow') filterDesc = 'Scheduled calls due tomorrow';
      else if (agendaFilterState.filter === 'overdue') filterDesc = 'Overdue follow-ups needing immediate action';
      else if (agendaFilterState.filter === 'completed') filterDesc = 'Completed customer follow-ups';
      else if (agendaFilterState.filter === 'all') filterDesc = 'All assigned client follow-ups';
      else if (agendaFilterState.date) filterDesc = `Scheduled calls for ${formatDate(agendaFilterState.date)}`;
      subTitle.innerText = `${filterDesc} (${list.length} records found) with complete customer profile & feedback`;
    }

    if (list.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px; background: rgba(255,255,255,0.02); border-radius: var(--radius-md); border: 1px dashed var(--border-color);">
          <div style="font-size: 2.2rem; margin-bottom: 8px;">🎉</div>
          <h4 style="color: var(--text-primary);">No Follow-ups Found for Current Filter</h4>
          <p style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 4px;">Is filter ke liye koi follow-up record match nahi hua. Quick buttons se filter change karein ya "+ Log New Call" se schedule karein.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = list.map(item => {
      const client = item.clientDetails || {};
      const isOverdue = item.nextFollowUpDate && new Date(item.nextFollowUpDate).setHours(0,0,0,0) < new Date().setHours(0,0,0,0);
      const isCompleted = item.isCompleted;

      let badgeClass = 'badge-active';
      let badgeText = '📞 Due Today';
      let borderClr = 'var(--accent-primary)';

      if (isCompleted) {
        badgeClass = 'badge-active';
        badgeText = '✓ Completed';
        borderClr = 'var(--accent-emerald)';
      } else if (isOverdue) {
        badgeClass = 'badge-inactive';
        badgeText = '⚠️ Overdue Follow-up';
        borderClr = 'var(--accent-rose)';
      } else if (item.nextFollowUpDate) {
        badgeClass = 'badge-slow';
        badgeText = `📅 Scheduled: ${formatDate(item.nextFollowUpDate)}`;
        borderClr = 'var(--accent-cyan)';
      }

      return `
        <div class="agenda-card" style="border-left: 4px solid ${borderClr};">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px; flex-wrap: wrap;">
              <span class="badge ${badgeClass}">${badgeText}</span>
              ${client.uniqueId ? `<span class="badge badge-none" style="font-size: 0.72rem;">${client.uniqueId}</span>` : ''}
              <span style="font-size: 0.82rem; color: var(--text-muted);">Scheduled Date: <strong>${formatDate(item.nextFollowUpDate)}</strong></span>
            </div>

            <div class="agenda-info">
              <h4>${item.clientName}</h4>
            </div>

            <div class="agenda-meta">
              <span>📱 <strong>${client.contactNumber || item.contactNumber || 'No Contact'}</strong></span>
              <span>📍 ${client.address || 'No Address'}</span>
              <span>🕒 Usual Gap: <strong>${client.usualOrderGap || 0} days</strong></span>
              <span>💰 Expected: <strong>${formatCurrency(item.orderExpectedAmount)}</strong></span>
              <span>👤 Responsible: <strong>${item.creName || 'CRE'}</strong></span>
            </div>

            <div class="agenda-feedback-box">
              <strong>Previous Feedback:</strong> "${item.customerFeedback || 'No feedback logged'}" 
              <span style="margin-left: 10px; font-weight: 600; color: ${item.sentiment === 'Positive' ? '#10b981' : (item.sentiment === 'Negative' ? '#f43f5e' : '#f59e0b')}">
                (${item.sentiment || 'Neutral'})
              </span>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px; margin-left: 20px; align-self: center;">
            <button class="btn btn-cre-action" style="padding: 8px 14px; font-size: 0.82rem;" onclick="quickFollowUpCall('${item.clientName}', '${item.contactNumber || client.contactNumber || ''}', '${item.clientId || ''}')">
              📞 Call Customer
            </button>
            ${!isCompleted ? `
              <button class="btn btn-secondary" style="padding: 8px 14px; font-size: 0.82rem; color: #10b981;" onclick="markFollowUpComplete('${item._id}')">
                ✓ Mark Completed
              </button>
            ` : `
              <span style="font-size: 0.75rem; color: var(--accent-emerald); text-align: center; font-weight: 600;">✓ Done</span>
            `}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div style="color: #f43f5e; padding: 20px;">Error loading agenda: ${err.message}</div>`;
  }
}

// Wire up filter controls for Agenda
function initAgendaControls() {
  const selPerson = document.getElementById('agendaResponsiblePerson');
  if (selPerson) {
    selPerson.addEventListener('change', (e) => {
      agendaFilterState.executive = e.target.value;
      loadTodayFollowUpAgenda();
    });
  }

  const searchInput = document.getElementById('agendaSearchInput');
  if (searchInput) {
    let searchTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        agendaFilterState.search = e.target.value;
        loadTodayFollowUpAgenda();
      }, 250);
    });
  }

  const datePicker = document.getElementById('agendaDateFilter');
  if (datePicker) {
    datePicker.addEventListener('change', (e) => {
      agendaFilterState.date = e.target.value;
      agendaFilterState.filter = ''; // custom date overrides quick filter
      document.querySelectorAll('.btn-quick-filter').forEach(b => b.classList.remove('active'));
      loadTodayFollowUpAgenda();
    });
  }

  // Quick filter buttons: Today, Tomorrow, Overdue, Show All Dates
  const quickBtns = document.querySelectorAll('.btn-quick-filter');
  quickBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      quickBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const f = btn.getAttribute('data-filter');
      agendaFilterState.filter = f;
      agendaFilterState.date = '';
      if (datePicker) datePicker.value = '';
      loadTodayFollowUpAgenda();
    });
  });

  // Clicking on counter cards activates corresponding filter
  const counterCards = document.querySelectorAll('.agenda-counter-card');
  counterCards.forEach(card => {
    card.addEventListener('click', () => {
      const f = card.getAttribute('data-counter');
      if (f) {
        agendaFilterState.filter = f;
        agendaFilterState.date = '';
        if (datePicker) datePicker.value = '';
        quickBtns.forEach(b => {
          if (b.getAttribute('data-filter') === f) b.classList.add('active');
          else b.classList.remove('active');
        });
        loadTodayFollowUpAgenda();
      }
    });
  });
}

// 2. All Follow-ups Log History
async function loadAllFollowupsHistory() {
  try {
    const res = await fetch('/api/followups');
    const data = await res.json();
    allFollowupsList = data.followups || [];
    renderFollowupsTable(allFollowupsList);
  } catch (err) {
    console.error('Error loading follow-ups history:', err);
  }
}

function renderFollowupsTable(list) {
  const tbody = document.querySelector('#allFollowupsTable tbody');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-muted);">No call follow-ups recorded yet.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(f => `
    <tr>
      <td>${formatDate(f.callDate)}</td>
      <td><strong>${f.clientName}</strong></td>
      <td>${f.contactNumber || '-'}</td>
      <td><span class="badge ${f.callStatus === 'Connected' || f.callStatus === 'Order Promised' ? 'badge-active' : 'badge-slow'}">${f.callStatus}</span></td>
      <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis;" title="${f.customerFeedback}">${f.customerFeedback}</td>
      <td><strong style="color: var(--accent-cyan);">${formatDate(f.nextFollowUpDate)}</strong></td>
      <td>${formatCurrency(f.orderExpectedAmount)}</td>
      <td>${f.creName || '-'}</td>
      <td>
        <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem; color: #f43f5e;" onclick="deleteFollowUp('${f._id}')">Delete</button>
      </td>
    </tr>
  `).join('');
}

document.getElementById('followUpSearch')?.addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  const filtered = allFollowupsList.filter(f => 
    f.clientName.toLowerCase().includes(q) || 
    (f.contactNumber && f.contactNumber.includes(q)) ||
    (f.creName && f.creName.toLowerCase().includes(q)) ||
    (f.customerFeedback && f.customerFeedback.toLowerCase().includes(q))
  );
  renderFollowupsTable(filtered);
});

async function markFollowUpComplete(id) {
  try {
    await fetch(`/api/followups/${id}/complete`, { method: 'PATCH' });
    loadTodayFollowUpAgenda();
    loadAllFollowupsHistory();
  } catch (err) {
    alert('Error marking complete: ' + err.message);
  }
}

async function deleteFollowUp(id) {
  if (!confirm('Are you sure you want to delete this follow-up record?')) return;
  try {
    await fetch(`/api/followups/${id}`, { method: 'DELETE' });
    loadTodayFollowUpAgenda();
    loadAllFollowupsHistory();
  } catch (err) {
    alert('Error deleting follow-up: ' + err.message);
  }
}

// Quick trigger from Agenda or Client Master
function quickFollowUpCall(clientName, contactNumber, clientId) {
  openCREModal({
    clientName,
    contactNumber,
    clientId
  });
}

// ==================== INTERACTIVE CALENDAR ==================== //
let calCurrentYear = new Date().getFullYear();
let calCurrentMonth = new Date().getMonth();
let calEvents = [];

async function loadFollowUpCalendar() {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  document.getElementById('calendarMonthTitle').innerText = `Follow-up Calendar: ${monthNames[calCurrentMonth]} ${calCurrentYear}`;

  try {
    const res = await fetch(`/api/followups/calendar?month=${calCurrentMonth}&year=${calCurrentYear}`);
    const data = await res.json();
    calEvents = data.events || [];
    renderCalendarGrid();
  } catch (err) {
    console.error('Error loading calendar:', err);
  }
}

function renderCalendarGrid() {
  const container = document.getElementById('calendarCellsContainer');
  if (!container) return;
  container.innerHTML = '';

  const firstDay = new Date(calCurrentYear, calCurrentMonth, 1).getDay();
  const daysInMonth = new Date(calCurrentYear, calCurrentMonth + 1, 0).getDate();
  const prevMonthDays = new Date(calCurrentYear, calCurrentMonth, 0).getDate();

  const todayStr = new Date().toISOString().split('T')[0];

  // Prev month padding cells
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const cell = document.createElement('div');
    cell.className = 'calendar-cell other-month';
    cell.innerHTML = `<span class="calendar-cell-date">${d}</span>`;
    container.appendChild(cell);
  }

  // Current month cells
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calCurrentYear}-${String(calCurrentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cell = document.createElement('div');
    cell.className = 'calendar-cell';
    if (dateStr === todayStr) {
      cell.classList.add('today');
    }

    // Filter events on this date
    const dayCalls = calEvents.filter(e => e.callDate && e.callDate.startsWith(dateStr));
    const dayFollowups = calEvents.filter(e => e.nextFollowUpDate && e.nextFollowUpDate.startsWith(dateStr));

    let eventsHTML = '';
    dayFollowups.slice(0, 2).forEach(f => {
      eventsHTML += `<div class="calendar-badge-event badge-followup-due" title="Follow-up due: ${f.clientName}">⏰ ${f.clientName}</div>`;
    });
    dayCalls.slice(0, 2).forEach(c => {
      eventsHTML += `<div class="calendar-badge-event badge-call-logged" title="Called: ${c.clientName}">📞 ${c.clientName}</div>`;
    });

    const totalMore = (dayFollowups.length + dayCalls.length) - 4;
    if (totalMore > 0) {
      eventsHTML += `<div style="font-size: 0.65rem; color: var(--accent-cyan); font-weight: 600;">+${totalMore} more</div>`;
    }

    cell.innerHTML = `
      <span class="calendar-cell-date">${d}</span>
      <div style="display: flex; flex-direction: column; flex: 1;">
        ${eventsHTML}
      </div>
    `;

    cell.onclick = () => selectCalendarDate(dateStr, dayFollowups, dayCalls);
    container.appendChild(cell);
  }
}

function selectCalendarDate(dateStr, followups, calls) {
  openCalendarDateModal(dateStr, followups, calls);
}

function openCalendarDateModal(dateStr, followups = [], calls = []) {
  const modal = document.getElementById('calendarDateModal');
  const title = document.getElementById('calModalDateTitle');
  const sub = document.getElementById('calModalDateSub');
  const list = document.getElementById('calModalEventsList');
  const addBtn = document.getElementById('btnCalModalAddAction');

  title.innerText = `📅 Activities on: ${formatDate(dateStr)}`;
  sub.innerText = `${followups.length} Follow-ups scheduled • ${calls.length} Calls logged`;

  addBtn.onclick = () => {
    closeCalendarDateModal();
    openCREModal({ nextFollowUpDate: dateStr, callDate: dateStr });
  };

  if (followups.length === 0 && calls.length === 0) {
    list.innerHTML = `
      <div style="text-align: center; padding: 36px 16px; background: rgba(255,255,255,0.02); border-radius: var(--radius-md); border: 1px dashed var(--border-color);">
        <div style="font-size: 2.2rem; margin-bottom: 8px;">🗓️</div>
        <h4 style="color: var(--text-primary); margin-bottom: 6px;">No Events on this Date</h4>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 14px;">No customer calls or follow-ups are recorded for ${formatDate(dateStr)}.</p>
        <button class="btn btn-primary" onclick="closeCalendarDateModal(); openCREModal({ nextFollowUpDate: '${dateStr}', callDate: '${dateStr}' });" style="font-size: 0.82rem;">
          + Schedule Follow-up Now
        </button>
      </div>
    `;
  } else {
    let html = '';

    if (followups.length > 0) {
      html += `
        <div style="margin-bottom: 16px;">
          <h5 style="color: #fbbf24; font-size: 0.88rem; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
            <span>⏰</span> Follow-ups Due (${followups.length})
          </h5>
      `;
      followups.forEach(f => {
        html += `
          <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: var(--radius-md); padding: 12px 14px; margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <strong style="color: var(--text-primary); font-size: 0.92rem;">${f.clientName}</strong>
                <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;">
                  📞 ${f.contactNumber || 'No contact'} ${f.creName ? '• By: ' + f.creName : ''}
                </div>
              </div>
              <button class="btn btn-primary" style="padding: 4px 10px; font-size: 0.74rem;" onclick="closeCalendarDateModal(); quickFollowUpCall('${f.clientName}', '${f.contactNumber || ''}', '${f.clientId || ''}')">
                📞 Call
              </button>
            </div>
            ${f.customerFeedback ? `<div style="font-size: 0.82rem; color: var(--text-primary); margin-top: 6px; background: rgba(0,0,0,0.2); padding: 6px 10px; border-radius: 4px;">Feedback: "${f.customerFeedback}"</div>` : ''}
          </div>
        `;
      });
      html += `</div>`;
    }

    if (calls.length > 0) {
      html += `
        <div>
          <h5 style="color: #10b981; font-size: 0.88rem; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
            <span>📞</span> Calls Logged (${calls.length})
          </h5>
      `;
      calls.forEach(c => {
        html += `
          <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: var(--radius-md); padding: 12px 14px; margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <strong style="color: var(--text-primary); font-size: 0.92rem;">${c.clientName}</strong>
                <span class="badge ${c.callStatus === 'Connected' || c.callStatus === 'Order Promised' ? 'badge-active' : 'badge-slow'}" style="margin-left: 6px; font-size: 0.7rem;">${c.callStatus}</span>
                <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;">
                  Executive: <strong>${c.creName || 'CRE'}</strong> ${c.orderExpectedAmount ? '• Expected: ₹' + c.orderExpectedAmount.toLocaleString() : ''}
                </div>
              </div>
              <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.74rem;" onclick="closeCalendarDateModal(); viewClientHistory('${c.clientId || ''}')">
                📜 History
              </button>
            </div>
            ${c.customerFeedback ? `<div style="font-size: 0.82rem; color: var(--text-primary); margin-top: 6px; background: rgba(0,0,0,0.2); padding: 6px 10px; border-radius: 4px;">Feedback: "${c.customerFeedback}"</div>` : ''}
          </div>
        `;
      });
      html += `</div>`;
    }

    list.innerHTML = html;
  }

  modal.classList.add('active');
}

function closeCalendarDateModal() {
  document.getElementById('calendarDateModal').classList.remove('active');
}

// Client Complete Follow-up History Audit Trail
async function viewClientHistory(clientId) {
  if (!clientId) {
    alert('Client ID not found for history');
    return;
  }

  const modal = document.getElementById('clientHistoryModal');
  const title = document.getElementById('historyClientName');
  const sub = document.getElementById('historyClientDetails');
  const list = document.getElementById('historyTimelineList');

  list.innerHTML = '<div style="text-align: center; padding: 30px; color: var(--text-muted);">Loading complete client history...</div>';
  modal.classList.add('active');

  try {
    const res = await fetch(`/api/clients/${clientId}/followup-history`);
    const data = await res.json();

    if (!data.success) {
      list.innerHTML = `<div style="color: #f43f5e; padding: 20px;">Error: ${data.error}</div>`;
      return;
    }

    const client = data.client || {};
    const history = data.history || [];

    title.innerText = `📜 Follow-up History: ${client.clientName}`;
    sub.innerText = `Contact: ${client.contactNumber || 'N/A'} • Total Interactions Recorded: ${history.length}`;

    if (history.length === 0) {
      list.innerHTML = `
        <div style="text-align: center; padding: 40px 16px; background: rgba(255,255,255,0.02); border-radius: var(--radius-md); border: 1px dashed var(--border-color);">
          <div style="font-size: 2rem; margin-bottom: 8px;">📭</div>
          <h4 style="color: var(--text-primary); margin-bottom: 4px;">No Past Follow-up History</h4>
          <p style="color: var(--text-muted); font-size: 0.84rem;">No calls or scheduled follow-ups have been logged yet for ${client.clientName}.</p>
        </div>
      `;
      return;
    }

    let html = '';
    history.forEach((h, idx) => {
      const callDateStr = formatDate(h.callDate);
      const nextDateStr = h.nextFollowUpDate ? formatDate(h.nextFollowUpDate) : 'Not scheduled';
      const isCompleted = h.isCompleted || h.callStatus === 'Connected' || h.callStatus === 'Order Promised';

      html += `
        <div style="position: relative; padding-left: 24px; margin-bottom: 18px; border-left: 2px solid ${isCompleted ? '#10b981' : '#f59e0b'};">
          <div style="position: absolute; left: -7px; top: 0; width: 12px; height: 12px; border-radius: 50%; background: ${isCompleted ? '#10b981' : '#f59e0b'};"></div>
          <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="font-weight: 700; font-size: 0.92rem; color: var(--text-primary);">
                Interaction #${history.length - idx} • ${callDateStr}
              </span>
              <span class="badge ${isCompleted ? 'badge-active' : 'badge-slow'}">${h.callStatus || 'Call Logged'}</span>
            </div>
            <div style="font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 8px; display: flex; flex-wrap: wrap; gap: 12px;">
              <span>Executive: <strong>${h.creName || 'CRE'}</strong></span>
              <span>Next Follow-up: <strong style="color: var(--accent-cyan);">${nextDateStr}</strong></span>
              ${h.orderExpectedAmount ? `<span>Expected Sale: <strong style="color: #10b981;">₹${h.orderExpectedAmount.toLocaleString()}</strong></span>` : ''}
              ${h.sentiment ? `<span>Sentiment: <strong>${h.sentiment}</strong></span>` : ''}
            </div>
            <div style="background: rgba(0, 0, 0, 0.25); border-radius: 6px; padding: 8px 12px; font-size: 0.84rem; color: var(--text-primary);">
              <strong>Remark:</strong> "${h.customerFeedback || '-'}"
            </div>
          </div>
        </div>
      `;
    });

    list.innerHTML = html;
  } catch (err) {
    list.innerHTML = `<div style="color: #f43f5e; padding: 20px;">Network error: ${err.message}</div>`;
  }
}

function closeClientHistoryModal() {
  document.getElementById('clientHistoryModal').classList.remove('active');
}

// Calendar Navigation
document.getElementById('btnCalPrev')?.addEventListener('click', () => {
  calCurrentMonth--;
  if (calCurrentMonth < 0) {
    calCurrentMonth = 11;
    calCurrentYear--;
  }
  loadFollowUpCalendar();
});

document.getElementById('btnCalNext')?.addEventListener('click', () => {
  calCurrentMonth++;
  if (calCurrentMonth > 11) {
    calCurrentMonth = 0;
    calCurrentYear++;
  }
  loadFollowUpCalendar();
});

document.getElementById('btnCalToday')?.addEventListener('click', () => {
  calCurrentYear = new Date().getFullYear();
  calCurrentMonth = new Date().getMonth();
  loadFollowUpCalendar();
});

// ==================== CRE MODAL HANDLERS ==================== //
function openCREModal(preset = {}) {
  document.getElementById('creClientId').value = preset.clientId || '';
  document.getElementById('creClientName').value = preset.clientName || '';
  document.getElementById('creContactNumber').value = preset.contactNumber || '';
  document.getElementById('creCallDate').value = preset.callDate || new Date().toISOString().split('T')[0];
  document.getElementById('creNextFollowUpDate').value = preset.nextFollowUpDate || '';
  document.getElementById('creFeedback').value = '';
  document.getElementById('creExpectedAmount').value = '';
  document.getElementById('creModal').classList.add('active');
}

function closeCREModal() {
  document.getElementById('creModal').classList.remove('active');
  document.getElementById('creForm').reset();
}

document.getElementById('creForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    clientId: document.getElementById('creClientId').value || null,
    clientName: document.getElementById('creClientName').value,
    contactNumber: document.getElementById('creContactNumber').value,
    callDate: document.getElementById('creCallDate').value,
    callStatus: document.getElementById('creCallStatus').value,
    customerFeedback: document.getElementById('creFeedback').value,
    nextFollowUpDate: document.getElementById('creNextFollowUpDate').value,
    orderExpectedAmount: parseFloat(document.getElementById('creExpectedAmount').value) || 0,
    sentiment: document.getElementById('creSentiment').value,
    creName: document.getElementById('creExecutiveName').value || 'CRE Executive'
  };

  try {
    const res = await fetch('/api/followups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.success) {
      closeCREModal();
      loadTodayFollowUpAgenda();
      loadAllFollowupsHistory();
      loadScotMonthly();
      loadFollowUpCalendar();
      alert('✅ CRE Call & Next Follow-up logged and saved to MongoDB & Calendar!');
    } else {
      alert('Error: ' + data.error);
    }
  } catch (err) {
    alert('Error saving follow-up: ' + err.message);
  }
});

// Attach top header button
document.getElementById('btnLogCRECall')?.addEventListener('click', () => openCREModal());

// ==================== QUICK CLIENT FOLLOW-UP MODAL ==================== //
function openQuickFollowUpModal(clientId, clientName, nextDate, takenBy, status, feedback) {
  document.getElementById('quickFollowUpClientId').value = clientId;
  document.getElementById('quickFollowUpClientName').value = clientName;
  document.getElementById('quickNextFollowUpDate').value = nextDate || new Date().toISOString().split('T')[0];
  document.getElementById('quickFollowUpTakenBy').value = takenBy || 'CRE Executive';
  document.getElementById('quickFollowUpStatus').value = status || 'Pending';
  document.getElementById('quickLastFeedback').value = feedback || '';
  document.getElementById('quickFollowUpModal').classList.add('active');
}

function closeQuickFollowUpModal() {
  document.getElementById('quickFollowUpModal').classList.remove('active');
  document.getElementById('quickFollowUpForm').reset();
}

document.getElementById('quickFollowUpForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const clientId = document.getElementById('quickFollowUpClientId').value;
  const body = {
    nextFollowUpDate: document.getElementById('quickNextFollowUpDate').value,
    followUpTakenBy: document.getElementById('quickFollowUpTakenBy').value,
    followUpStatus: document.getElementById('quickFollowUpStatus').value,
    lastFeedback: document.getElementById('quickLastFeedback').value
  };

  try {
    const res = await fetch(`/api/clients/${clientId}/followup`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.success) {
      closeQuickFollowUpModal();
      loadScotMonthly();
      loadTodayFollowUpAgenda();
      loadFollowUpCalendar();
      loadAllFollowupsHistory();
      alert('✅ Follow-up status & Next date updated successfully!');
    } else {
      alert('Error updating follow-up: ' + data.error);
    }
  } catch (err) {
    alert('Network error: ' + err.message);
  }
});

// ==================== GOOGLE SHEETS LIVE SYNC ==================== //
document.getElementById('btnSyncGoogleSheet')?.addEventListener('click', async () => {
  const urlInput = document.getElementById('googleSheetUrlInput');
  const statusDiv = document.getElementById('googleSheetSyncStatus');
  const sheetUrl = (urlInput.value || '').trim();

  if (!sheetUrl) {
    alert('Please enter your Google Sheet link!');
    return;
  }

  statusDiv.innerHTML = '<span style="color: var(--accent-cyan);">⏳ Connecting to Google Sheets and syncing data to MongoDB...</span>';

  try {
    const res = await fetch('/api/sync-google-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetUrl })
    });
    const data = await res.json();

    if (data.success) {
      statusDiv.innerHTML = `<span style="color: #10b981;">✅ ${data.message}</span>`;
      loadDashboard();
      loadTodayFollowUpAgenda();
    } else {
      statusDiv.innerHTML = `<span style="color: #f43f5e;">❌ ${data.error}</span>`;
    }
  } catch (err) {
    statusDiv.innerHTML = `<span style="color: #f43f5e;">❌ Connection failed: ${err.message}</span>`;
  }
});

// Export Current Sheet
document.getElementById('btnExportCurrent')?.addEventListener('click', () => {
  window.open(`/api/export/scot/${encodeURIComponent(currentMonthKey)}`, '_blank');
});

// Setup Top Header buttons
document.getElementById('btnRefresh')?.addEventListener('click', () => {
  loadDashboard();
  loadTodayFollowUpAgenda();
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

// ==================== SIDEBAR AUTO-REMOVE & TOGGLE ==================== //
function initSidebar() {
  const toggleBtn = document.getElementById('btnSidebarToggle');
  const backdrop = document.getElementById('sidebarBackdrop');

  // Toggle button click
  toggleBtn?.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem('scot_sidebar_collapsed', document.body.classList.contains('sidebar-collapsed'));
  });

  // Auto-remove when clicking outside / on backdrop
  backdrop?.addEventListener('click', () => {
    document.body.classList.add('sidebar-collapsed');
    localStorage.setItem('scot_sidebar_collapsed', true);
  });

  // Check saved state or auto-remove on smaller laptop/tablet screens
  const savedState = localStorage.getItem('scot_sidebar_collapsed');
  if (savedState === 'true' || window.innerWidth < 1100) {
    document.body.classList.add('sidebar-collapsed');
  }
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initSidebar();
  initAgendaControls();
  loadDashboard();
});

