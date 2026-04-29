const express = require('express');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');

const router = express.Router();

// ── POST /api/auth/register ──────────────────────────────────────────────────
// Creates a new consumer account
router.post('/register', async (req, res) => {
  try {
    const {
      email, password, name, consumerNo, meterNo,
      phone, address, tariff, sanctionLoad, supplyDate, circle, division,
    } = req.body;

    if (!email || !password || !name || !consumerNo || !meterNo)
      return res.status(400).json({ error: 'email, password, name, consumerNo, meterNo are required' });

    const exists = await User.findOne({ $or: [{ email }, { consumerNo }] });
    if (exists) return res.status(409).json({ error: 'Email or Consumer No. already registered' });

    const user = await User.create({
      email, password, name, consumerNo, meterNo,
      phone, address, tariff, sanctionLoad, supplyDate, circle, division,
    });

    const token = jwt.sign(
      { id: user._id, consumerNo: user.consumerNo },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({ token, user: safeUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password required' });

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await user.comparePassword(password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user._id, consumerNo: user.consumerNo },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: safeUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
// Returns logged-in user profile
const auth = require('../middleware/auth');
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function safeUser(u) {
  return {
    id: u._id, name: u.name, email: u.email,
    consumerNo: u.consumerNo, meterNo: u.meterNo,
    phone: u.phone, address: u.address,
    tariff: u.tariff, sanctionLoad: u.sanctionLoad,
    supplyDate: u.supplyDate, circle: u.circle, division: u.division,
    espDeviceId: u.espDeviceId,
  };
}

module.exports = router;
