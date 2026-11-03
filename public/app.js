// app.js
const API = '/api';
const CURRENCY = '$'; // change to '₹' if you want rupees
let token = localStorage.getItem('ft_token');
let username = localStorage.getItem('ft_username');

let categoryChart = null;
let monthlyChart = null;

const CHART_COLORS = ['#2563eb', '#0ea5e9', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6', '#ec4899', '#64748b'];

// ---------- Element refs ----------
const authScreen = document.getElementById('authScreen');
const dashboard = document.getElementById('dashboard');
const authError = document.getElementById('authError');

// ---------- Helpers ----------
function fmtMoney(n) {
  return CURRENCY + Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// Today's date in the user's LOCAL timezone (valueAsDate uses UTC and can show yesterday)
function todayLocal() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Tab switching ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('loginForm').classList.toggle('hidden', btn.dataset.tab !== 'login');
    document.getElementById('registerForm').classList.toggle('hidden', btn.dataset.tab !== 'register');
    authError.classList.add('hidden');
  });
});

// ---------- Auth ----------
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    username: document.getElementById('loginUsername').value.trim(),
    password: document.getElementById('loginPassword').value
  };
  await authRequest('/login', body);
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    username: document.getElementById('registerUsername').value.trim(),
    password: document.getElementById('registerPassword').value
  };
  await authRequest('/register', body);
});

async function authRequest(path, body) {
  authError.classList.add('hidden');
  try {
    const res = await fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    token = data.token;
    username = data.username;
    localStorage.setItem('ft_token', token);
    localStorage.setItem('ft_username', username);
    showDashboard();
  } catch (err) {
    authError.textContent = err.message;
    authError.classList.remove('hidden');
  }
}

document.getElementById('logoutBtn').addEventListener('click', () => {
  token = null;
  localStorage.removeItem('ft_token');
  localStorage.removeItem('ft_username');
  if (categoryChart) { categoryChart.destroy(); categoryChart = null; }
  if (monthlyChart) { monthlyChart.destroy(); monthlyChart = null; }
  dashboard.classList.add('hidden');
  authScreen.classList.remove('hidden');
});

// ---------- Authenticated fetch helper ----------
async function api(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      ...(options.headers || {})
    }
  });
  if (res.status === 401) {
    // token expired/invalid - force logout
    document.getElementById('logoutBtn').click();
    throw new Error('Session expired, please log in again');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------- Dashboard bootstrap ----------
function showDashboard() {
  authScreen.classList.add('hidden');
  dashboard.classList.remove('hidden');
  document.getElementById('welcomeUser').textContent = 'Hi, ' + username;
  document.getElementById('expDate').value = todayLocal();
  loadAll();
}

async function loadAll() {
  try {
    // Fetch the category breakdown once and share it (budgets + chart both need it)
    const [{ breakdown }] = await Promise.all([
      api('/reports/category'),
      loadExpenses(),
      loadMonthlyChart(),
      loadAlerts()
    ]);
    await loadBudgets(breakdown);
    renderCategoryChart(breakdown);
  } catch (err) {
    console.error('Failed to load dashboard:', err);
  }
}

// ---------- Expenses ----------
document.getElementById('expenseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    date: document.getElementById('expDate').value,
    category: document.getElementById('expCategory').value.trim(),
    amount: document.getElementById('expAmount').value,
    description: document.getElementById('expDescription').value.trim()
  };
  try {
    await api('/expenses', { method: 'POST', body: JSON.stringify(body) });
    e.target.reset();
    document.getElementById('expDate').value = todayLocal();
    loadAll();
  } catch (err) {
    alert(err.message);
  }
});

async function loadExpenses() {
  const expenses = await api('/expenses');
  const tbody = document.getElementById('expenseTableBody');
  tbody.innerHTML = '';
  expenses.forEach(exp => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(exp.date)}</td>
      <td>${escapeHtml(exp.category)}</td>
      <td>${fmtMoney(exp.amount)}</td>
      <td>${escapeHtml(exp.description || '')}</td>
      <td><button class="del-row-btn" data-id="${exp.id}">✕</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('.del-row-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this expense?')) return;
      try {
        await api('/expenses/' + btn.dataset.id, { method: 'DELETE' });
        loadAll();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

// ---------- Budgets ----------
document.getElementById('budgetForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    category: document.getElementById('budCategory').value.trim(),
    limit: document.getElementById('budLimit').value
  };
  try {
    await api('/budgets', { method: 'POST', body: JSON.stringify(body) });
    e.target.reset();
    loadAll();
  } catch (err) {
    alert(err.message);
  }
});

async function loadBudgets(breakdown) {
  const budgets = await api('/budgets');
  const spendMap = {};
  breakdown.forEach(b => { spendMap[b.category] = b.total; });

  const list = document.getElementById('budgetList');
  list.innerHTML = '';
  budgets.forEach(b => {
    const spent = spendMap[b.category] || 0;
    const pct = b.limit > 0 ? Math.min(100, Math.round((spent / b.limit) * 100)) : 0;
    const over = spent > b.limit;
    const li = document.createElement('li');
    li.innerHTML = `
      <div style="flex:1">
        <div style="display:flex;justify-content:space-between">
          <span>${escapeHtml(b.category)}</span>
          <span>${fmtMoney(spent)} / ${fmtMoney(b.limit)}</span>
        </div>
        <div class="progress"><div class="progress-fill ${over ? 'over' : ''}" style="width:${pct}%"></div></div>
      </div>
      <button class="del-btn" data-id="${b.id}" title="Remove budget">✕</button>
    `;
    list.appendChild(li);
  });
  list.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api('/budgets/' + btn.dataset.id, { method: 'DELETE' });
        loadAll();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

// ---------- Budget Alerts ----------
async function loadAlerts() {
  const alerts = await api('/budget-alerts');
  const banner = document.getElementById('alertsBanner');
  if (alerts.length === 0) {
    banner.classList.add('hidden');
    return;
  }
  banner.classList.remove('hidden');
  banner.innerHTML = '<strong>⚠️ Budget Alerts</strong><br>' + alerts.map(a => {
    const status = a.pct >= 100 ? 'exceeded' : 'is close to';
    return `${escapeHtml(a.category)}: ${fmtMoney(a.spent)} of ${fmtMoney(a.limit)} (${a.pct}%) — ${status} the limit`;
  }).join('<br>');
}

// ---------- Charts ----------
// Doughnut where every category stays visible: each slice gets at least
// MIN_SLICE of the circle, while the legend and tooltip show the REAL amounts.
function renderCategoryChart(breakdown) {
  const ctx = document.getElementById('categoryChart');
  if (categoryChart) categoryChart.destroy();

  const labels = breakdown.map(b => b.category);
  const real = breakdown.map(b => b.total);
  const total = real.reduce((a, b) => a + b, 0);

  const MIN_SLICE = 0.06; // 6% of the circle minimum
  const minValue = total * MIN_SLICE;
  const shown = real.map(v => Math.max(v, minValue));

  const pctOf = (v) => (total > 0 ? ((v / total) * 100).toFixed(1) : '0.0');

  categoryChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: shown,
        backgroundColor: labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
        borderColor: '#ffffff',
        borderWidth: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '50%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            generateLabels: (chart) => labels.map((label, i) => ({
              text: `${label}: ${fmtMoney(real[i])} (${pctOf(real[i])}%)`,
              fillStyle: CHART_COLORS[i % CHART_COLORS.length],
              strokeStyle: CHART_COLORS[i % CHART_COLORS.length],
              hidden: !chart.getDataVisibility(i),
              index: i
            }))
          }
        },
        tooltip: {
          callbacks: {
            label: (c) => ` ${labels[c.dataIndex]}: ${fmtMoney(real[c.dataIndex])} (${pctOf(real[c.dataIndex])}%)`
          }
        }
      }
    }
  });
}

async function loadMonthlyChart() {
  const data = await api('/reports/monthly');
  const ctx = document.getElementById('monthlyChart');
  if (monthlyChart) monthlyChart.destroy();
  monthlyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.month),
      datasets: [{ label: 'Total Spent', data: data.map(d => d.total), backgroundColor: '#2563eb' }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: { y: { beginAtZero: true } },
      plugins: {
        tooltip: {
          callbacks: { label: (c) => ` Total: ${fmtMoney(c.parsed.y)}` }
        }
      }
    }
  });
}

// ---------- CSV Export ----------
document.getElementById('exportCsvBtn').addEventListener('click', () => {
  const month = document.getElementById('exportMonth').value;
  const url = `${API}/export/csv${month ? '?month=' + month : ''}`;
  fetch(url, { headers: { Authorization: 'Bearer ' + token } })
    .then(res => {
      if (!res.ok) throw new Error('Export failed');
      return res.blob();
    })
    .then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = month ? `expenses-${month}.csv` : 'expenses-all.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    })
    .catch(() => alert('Export failed'));
});

// ---------- Init ----------
if (token) {
  showDashboard();
}
