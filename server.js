// server.js
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const mongoose = require('mongoose');

const JWT_SECRET = '9b2f6c1e0a47d83f5e1c7a9d2b4f8e60c3f5d7f19e2b4c6a8d0f1e3b5a7c9d24';
const PORT = process.env.PORT || 4000;
const MONGODB_URI = 'mongodb+srv://shreeshailsangolge05_db_user:shree66666@cluster0.xvhvxls.mongodb.net/';

if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI environment variable. Set it in Vercel → Settings → Environment Variables.');
}

// ---- DB setup (MongoDB Atlas via Mongoose) ----
// Reuse the connection across serverless invocations instead of reconnecting every request.
let connPromise = null;
function connectDB() {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  if (!connPromise) {
    connPromise = mongoose.connect(MONGODB_URI);
  }
  return connPromise;
}

const userSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  username: { type: String, unique: true, index: true },
  password: String,
  createdAt: { type: String, default: () => new Date().toISOString() }
});

const expenseSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  userId: { type: String, index: true },
  date: String,
  category: String,
  amount: Number,
  description: String
});

const budgetSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  userId: { type: String, index: true },
  category: String,
  limit: Number
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Expense = mongoose.models.Expense || mongoose.model('Expense', expenseSchema);
const Budget = mongoose.models.Budget || mongoose.model('Budget', budgetSchema);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Make sure we're connected before handling any /api request
app.use('/api', async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('DB connection error:', err);
    res.status(500).json({ error: 'Database connection failed' });
  }
});

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---- Auth middleware ----
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    req.username = payload.username;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ================= AUTH ROUTES =================

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }
  const existing = await User.findOne({ username });
  if (existing) return res.status(409).json({ error: 'Username already taken' });

  const hashed = bcrypt.hashSync(password, 10);
  const user = await User.create({
    id: genId(),
    username,
    password: hashed,
    createdAt: new Date().toISOString()
  });

  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username: user.username });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username: user.username });
});

// ================= EXPENSE ROUTES =================

app.get('/api/expenses', auth, async (req, res) => {
  const expenses = await Expense.find({ userId: req.userId }).sort({ date: -1 });
  res.json(expenses);
});

app.post('/api/expenses', auth, async (req, res) => {
  const { date, category, amount, description } = req.body;
  if (!date || !category || amount === undefined) {
    return res.status(400).json({ error: 'date, category and amount are required' });
  }
  const expense = await Expense.create({
    id: genId(),
    userId: req.userId,
    date,
    category,
    amount: parseFloat(amount),
    description: description || ''
  });
  res.status(201).json(expense);
});

app.put('/api/expenses/:id', auth, async (req, res) => {
  const expense = await Expense.findOne({ id: req.params.id, userId: req.userId });
  if (!expense) return res.status(404).json({ error: 'Expense not found' });

  const { date, category, amount, description } = req.body;
  expense.date = date ?? expense.date;
  expense.category = category ?? expense.category;
  expense.amount = amount !== undefined ? parseFloat(amount) : expense.amount;
  expense.description = description ?? expense.description;
  await expense.save();
  res.json(expense);
});

app.delete('/api/expenses/:id', auth, async (req, res) => {
  const expense = await Expense.findOne({ id: req.params.id, userId: req.userId });
  if (!expense) return res.status(404).json({ error: 'Expense not found' });
  await Expense.deleteOne({ id: req.params.id, userId: req.userId });
  res.json({ success: true });
});

// ================= REPORTS =================

// Monthly totals for the last 12 months
app.get('/api/reports/monthly', auth, async (req, res) => {
  const expenses = await Expense.find({ userId: req.userId });
  const totals = {};
  expenses.forEach(e => {
    const month = e.date.slice(0, 7); // YYYY-MM
    totals[month] = (totals[month] || 0) + e.amount;
  });
  const sorted = Object.entries(totals)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, total]) => ({ month, total: Math.round(total * 100) / 100 }));
  res.json(sorted);
});

// Category breakdown for a given month (defaults to current month)
app.get('/api/reports/category', auth, async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const allExpenses = await Expense.find({ userId: req.userId });
  const expenses = allExpenses.filter(e => e.date.slice(0, 7) === month);
  const totals = {};
  expenses.forEach(e => {
    totals[e.category] = (totals[e.category] || 0) + e.amount;
  });
  const result = Object.entries(totals).map(([category, total]) => ({
    category,
    total: Math.round(total * 100) / 100
  }));
  res.json({ month, breakdown: result });
});

// ================= BUDGETS & ALERTS =================

app.get('/api/budgets', auth, async (req, res) => {
  res.json(await Budget.find({ userId: req.userId }));
});

app.post('/api/budgets', auth, async (req, res) => {
  const { category, limit } = req.body;
  if (!category || limit === undefined) {
    return res.status(400).json({ error: 'category and limit are required' });
  }
  const existing = await Budget.findOne({ userId: req.userId, category });
  if (existing) {
    existing.limit = parseFloat(limit);
    await existing.save();
  } else {
    await Budget.create({ id: genId(), userId: req.userId, category, limit: parseFloat(limit) });
  }
  res.json(await Budget.find({ userId: req.userId }));
});

app.delete('/api/budgets/:id', auth, async (req, res) => {
  await Budget.deleteOne({ id: req.params.id, userId: req.userId });
  res.json({ success: true });
});

// Alerts: categories where current-month spend has reached/exceeded the budget
app.get('/api/budget-alerts', auth, async (req, res) => {
  const month = new Date().toISOString().slice(0, 7);
  const budgets = await Budget.find({ userId: req.userId });
  const allExpenses = await Expense.find({ userId: req.userId });
  const expenses = allExpenses.filter(e => e.date.slice(0, 7) === month);

  const spendByCategory = {};
  expenses.forEach(e => {
    spendByCategory[e.category] = (spendByCategory[e.category] || 0) + e.amount;
  });

  const alerts = budgets
    .map(b => {
      const spent = spendByCategory[b.category] || 0;
      const pct = b.limit > 0 ? (spent / b.limit) * 100 : 0;
      return { category: b.category, limit: b.limit, spent: Math.round(spent * 100) / 100, pct: Math.round(pct) };
    })
    .filter(a => a.pct >= 80); // warn at 80%+, flag as exceeded at 100%+

  res.json(alerts);
});

// ================= CSV EXPORT =================

app.get('/api/export/csv', auth, async (req, res) => {
  const month = req.query.month; // optional YYYY-MM filter
  let expenses = await Expense.find({ userId: req.userId });
  if (month) {
    expenses = expenses.filter(e => e.date.slice(0, 7) === month);
  }
  expenses = [...expenses].sort((a, b) => a.date.localeCompare(b.date));

  const escapeCsv = (val) => {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  const header = ['Date', 'Category', 'Amount', 'Description'];
  const rows = expenses.map(e => [e.date, e.category, e.amount.toFixed(2), e.description]);
  const csv = [header, ...rows].map(row => row.map(escapeCsv).join(',')).join('\n');

  const filename = month ? `expenses-${month}.csv` : 'expenses-all.csv';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

// ---- Fallback to index.html for the SPA ----
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Vercel runs this as a serverless function via module.exports;
// app.listen only matters for local `npm start` / `npm run dev`.
if (require.main === module) {
  connectDB()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Personal Finance Tracker running at http://localhost:${PORT}`);
      });
    })
    .catch(err => {
      console.error('Failed to connect to MongoDB:', err);
      process.exit(1);
    });
}

module.exports = app;
