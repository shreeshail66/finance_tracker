
// server.js

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const mongoose = require('mongoose');

// ==========================================
// ENVIRONMENT CONFIGURATION
// ==========================================

const JWT_SECRET = process.env.JWT_SECRET;
const MONGODB_URI = process.env.MONGODB_URI;
const PORT = process.env.PORT || 4000;

if (!JWT_SECRET) {
    throw new Error('Missing JWT_SECRET environment variable');
}

if (!MONGODB_URI) {
    throw new Error('Missing MONGODB_URI environment variable');
}

// ==========================================
// DATABASE CONNECTION
// ==========================================

let connPromise = null;

function connectDB() {
    if (mongoose.connection.readyState === 1) {
        return Promise.resolve();
    }

    if (!connPromise) {
        connPromise = mongoose.connect(MONGODB_URI)
            .catch((err) => {
                connPromise = null;
                throw err;
            });
    }

    return connPromise;
}

// ==========================================
// DATABASE SCHEMAS
// ==========================================

const userSchema = new mongoose.Schema({
    id: {
        type: String,
        unique: true,
        index: true
    },
    username: {
        type: String,
        unique: true,
        index: true
    },
    password: String,
    createdAt: {
        type: String,
        default: () => new Date().toISOString()
    }
});

const expenseSchema = new mongoose.Schema({
    id: {
        type: String,
        unique: true,
        index: true
    },
    userId: {
        type: String,
        index: true
    },
    date: String,
    category: String,
    amount: Number,
    description: String
});

const budgetSchema = new mongoose.Schema({
    id: {
        type: String,
        unique: true,
        index: true
    },
    userId: {
        type: String,
        index: true
    },
    category: String,
    limit: Number
});

const User = mongoose.models.User ||
    mongoose.model('User', userSchema);

const Expense = mongoose.models.Expense ||
    mongoose.model('Expense', expenseSchema);

const Budget = mongoose.models.Budget ||
    mongoose.model('Budget', budgetSchema);

// ==========================================
// EXPRESS CONFIGURATION
// ==========================================

const app = express();

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

// Connect to MongoDB before handling API requests
app.use('/api', async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        console.error('Database connection error:', err.message);

        res.status(500).json({
            error: 'Database connection failed'
        });
    }
});

const genId = () =>
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8);

// ==========================================
// AUTHENTICATION MIDDLEWARE
// ==========================================

function auth(req, res, next) {
    const header = req.headers.authorization || '';

    const token = header.startsWith('Bearer ')
        ? header.slice(7)
        : null;

    if (!token) {
        return res.status(401).json({
            error: 'No token provided'
        });
    }

    try {
        const payload = jwt.verify(token, JWT_SECRET);

        req.userId = payload.userId;
        req.username = payload.username;

        next();
    } catch (err) {
        return res.status(401).json({
            error: 'Invalid or expired token'
        });
    }
}

// ==========================================
// AUTH ROUTES
// ==========================================

// REGISTER
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                error: 'Username and password are required'
            });
        }

        if (password.length < 4) {
            return res.status(400).json({
                error: 'Password must be at least 4 characters'
            });
        }

        const existing = await User.findOne({ username });

        if (existing) {
            return res.status(409).json({
                error: 'Username already taken'
            });
        }

        const hashed = await bcrypt.hash(password, 10);

        const user = await User.create({
            id: genId(),
            username,
            password: hashed,
            createdAt: new Date().toISOString()
        });

        const token = jwt.sign(
            {
                userId: user.id,
                username: user.username
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            token,
            username: user.username
        });

    } catch (err) {
        console.error('Registration error:', err.message);

        res.status(500).json({
            error: 'Registration failed'
        });
    }
});

// LOGIN
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await User.findOne({ username });

        if (!user || !await bcrypt.compare(password || '', user.password)) {
            return res.status(401).json({
                error: 'Invalid username or password'
            });
        }

        const token = jwt.sign(
            {
                userId: user.id,
                username: user.username
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            token,
            username: user.username
        });

    } catch (err) {
        console.error('Login error:', err.message);

        res.status(500).json({
            error: 'Login failed'
        });
    }
});

// ==========================================
// EXPENSE ROUTES
// ==========================================

// GET ALL EXPENSES
app.get('/api/expenses', auth, async (req, res) => {
    try {
        const expenses = await Expense.find({
            userId: req.userId
        }).sort({ date: -1 });

        res.json(expenses);

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Failed to fetch expenses' });
    }
});

// ADD EXPENSE
app.post('/api/expenses', auth, async (req, res) => {
    try {
        const { date, category, amount, description } = req.body;

        if (!date || !category || amount === undefined ||
            !Number.isFinite(Number(amount))) {
            return res.status(400).json({
                error: 'Valid date, category and amount are required'
            });
        }

        const expense = await Expense.create({
            id: genId(),
            userId: req.userId,
            date,
            category,
            amount: Number(amount),
            description: description || ''
        });

        res.status(201).json(expense);

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Failed to add expense' });
    }
});

// UPDATE EXPENSE
app.put('/api/expenses/:id', auth, async (req, res) => {
    try {
        const expense = await Expense.findOne({
            id: req.params.id,
            userId: req.userId
        });

        if (!expense) {
            return res.status(404).json({
                error: 'Expense not found'
            });
        }

        const { date, category, amount, description } = req.body;

        if (amount !== undefined && !Number.isFinite(Number(amount))) {
            return res.status(400).json({
                error: 'Amount must be a valid number'
            });
        }

        expense.date = date ?? expense.date;
        expense.category = category ?? expense.category;
        expense.amount = amount !== undefined
            ? Number(amount)
            : expense.amount;
        expense.description = description ?? expense.description;

        await expense.save();

        res.json(expense);

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Failed to update expense' });
    }
});

// DELETE EXPENSE
app.delete('/api/expenses/:id', auth, async (req, res) => {
    try {
        const expense = await Expense.findOne({
            id: req.params.id,
            userId: req.userId
        });

        if (!expense) {
            return res.status(404).json({
                error: 'Expense not found'
            });
        }

        await Expense.deleteOne({
            id: req.params.id,
            userId: req.userId
        });

        res.json({ success: true });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Failed to delete expense' });
    }
});

// ==========================================
// REPORT ROUTES
// ==========================================

// MONTHLY REPORT
app.get('/api/reports/monthly', auth, async (req, res) => {
    try {
        const expenses = await Expense.find({
            userId: req.userId
        });

        const totals = {};

        expenses.forEach(expense => {
            const month = expense.date.slice(0, 7);

            totals[month] = (totals[month] || 0) + expense.amount;
        });

        const sorted = Object.entries(totals)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([month, total]) => ({
                month,
                total: Math.round(total * 100) / 100
            }));

        res.json(sorted);

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Failed to generate monthly report' });
    }
});

// CATEGORY REPORT
app.get('/api/reports/category', auth, async (req, res) => {
    try {
        const month = req.query.month ||
            new Date().toISOString().slice(0, 7);

        const allExpenses = await Expense.find({
            userId: req.userId
        });

        const expenses = allExpenses.filter(
            expense => expense.date.slice(0, 7) === month
        );

        const totals = {};

        expenses.forEach(expense => {
            totals[expense.category] =
                (totals[expense.category] || 0) + expense.amount;
        });

        const result = Object.entries(totals).map(
            ([category, total]) => ({
                category,
                total: Math.round(total * 100) / 100
            })
        );

        res.json({
            month,
            breakdown: result
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Failed to generate category report' });
    }
});

// ==========================================
// BUDGET ROUTES & ALERTS
// ==========================================

// GET BUDGETS
app.get('/api/budgets', auth, async (req, res) => {
    try {
        const budgets = await Budget.find({
            userId: req.userId
        });

        res.json(budgets);

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Failed to fetch budgets' });
    }
});

// ADD OR UPDATE BUDGET
app.post('/api/budgets', auth, async (req, res) => {
    try {
        const { category, limit } = req.body;

        if (!category || limit === undefined ||
            !Number.isFinite(Number(limit)) || Number(limit) < 0) {
            return res.status(400).json({
                error: 'Valid category and budget limit are required'
            });
        }

        const existing = await Budget.findOne({
            userId: req.userId,
            category
        });

        if (existing) {
            existing.limit = Number(limit);
            await existing.save();
        } else {
            await Budget.create({
                id: genId(),
                userId: req.userId,
                category,
                limit: Number(limit)
            });
        }

        res.json(await Budget.find({
            userId: req.userId
        }));

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Failed to save budget' });
    }
});

// DELETE BUDGET
app.delete('/api/budgets/:id', auth, async (req, res) => {
    try {
        await Budget.deleteOne({
            id: req.params.id,
            userId: req.userId
        });

        res.json({ success: true });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Failed to delete budget' });
    }
});

// BUDGET ALERTS
app.get('/api/budget-alerts', auth, async (req, res) => {
    try {
        const month = new Date().toISOString().slice(0, 7);

        const budgets = await Budget.find({
            userId: req.userId
        });

        const allExpenses = await Expense.find({
            userId: req.userId
        });

        const expenses = allExpenses.filter(
            expense => expense.date.slice(0, 7) === month
        );

        const spendByCategory = {};

        expenses.forEach(expense => {
            spendByCategory[expense.category] =
                (spendByCategory[expense.category] || 0) + expense.amount;
        });

        const alerts = budgets
            .map(budget => {
                const spent = spendByCategory[budget.category] || 0;

                const pct = budget.limit > 0
                    ? (spent / budget.limit) * 100
                    : 0;

                return {
                    category: budget.category,
                    limit: budget.limit,
                    spent: Math.round(spent * 100) / 100,
                    pct: Math.round(pct)
                };
            })
            .filter(alert => alert.pct >= 80);

        res.json(alerts);

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Failed to fetch budget alerts' });
    }
});

// ==========================================
// CSV EXPORT
// ==========================================

app.get('/api/export/csv', auth, async (req, res) => {
    try {
        const month = req.query.month;

        let expenses = await Expense.find({
            userId: req.userId
        });

        if (month) {
            expenses = expenses.filter(
                expense => expense.date.slice(0, 7) === month
            );
        }

        expenses = [...expenses].sort(
            (a, b) => a.date.localeCompare(b.date)
        );

        const escapeCsv = (value) => {
            const str = String(value ?? '');

            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return '"' + str.replace(/"/g, '""') + '"';
            }

            return str;
        };

        const header = [
            'Date',
            'Category',
            'Amount',
            'Description'
        ];

        const rows = expenses.map(expense => [
            expense.date,
            expense.category,
            expense.amount.toFixed(2),
            expense.description
        ]);

        const csv = [header, ...rows]
            .map(row => row.map(escapeCsv).join(','))
            .join('\n');

        const filename = month
            ? `expenses-${month}.csv`
            : 'expenses-all.csv';

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${filename}"`
        );

        res.send(csv);

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'CSV export failed' });
    }
});

// ==========================================
// FRONTEND FALLBACK
// ==========================================

app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return next();
    }

    res.sendFile(
        path.join(__dirname, 'public', 'index.html')
    );
});

// ==========================================
// ERROR HANDLER
// ==========================================

app.use((err, req, res, next) => {
    console.error('Server error:', err.message);

    res.status(500).json({
        error: 'Internal server error'
    });
});

// ==========================================
// SERVER START
// ==========================================

if (require.main === module) {
    connectDB()
        .then(() => {
            app.listen(PORT, () => {
                console.log(
                    `Personal Finance Tracker running at http://localhost:${PORT}`
                );
            });
        })
        .catch(err => {
            console.error(
                'Failed to connect to MongoDB:',
                err.message
            );

            process.exit(1);
        });
}

module.exports = app;
