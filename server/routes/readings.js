const express = require('express');
const Reading = require('../models/Reading');
const User    = require('../models/User');
const auth    = require('../middleware/auth');
 
const router = express.Router();
 
// ── POST /api/readings ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const espToken = req.headers['x-esp-token'];
  if (espToken !== process.env.ESP_SECRET)
    return res.status(403).json({ error: 'Invalid ESP token' });
 
  try {
    const {
      consumerNo, voltage, current, power, energy,
      frequency = 50, powerFactor, reactivePower,
      source = 'esp',
    } = req.body;
 
    if (!consumerNo || voltage == null || current == null || power == null || energy == null)
      return res.status(400).json({ error: 'consumerNo, voltage, current, power, energy required' });
 
    const user = await User.findOne({ consumerNo });
    if (!user) return res.status(404).json({ error: 'Consumer not found' });
 
    const reading = await Reading.create({
      consumerNo, voltage, current, power, energy,
      frequency, powerFactor, reactivePower, source,
    });
 
    if (req.app.locals.wsBroadcast) {
      req.app.locals.wsBroadcast(consumerNo, { type: 'READING', data: reading });
    }
 
    res.status(201).json({ ok: true, id: reading._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
// ── GET /api/readings/latest ─────────────────────────────────────────────────
router.get('/latest', auth, async (req, res) => {
  try {
    const { consumerNo } = req.user;
    const reading = await Reading.findOne({ consumerNo }).sort({ timestamp: -1 });
    res.json({ reading });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
// ── GET /api/readings/live?limit=50 ─────────────────────────────────────────
router.get('/live', auth, async (req, res) => {
  try {
    const { consumerNo } = req.user;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const readings = await Reading.find({ consumerNo })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    res.json({ readings: readings.reverse() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
// ── GET /api/readings/daily?date=YYYY-MM-DD ──────────────────────────────────
router.get('/daily', auth, async (req, res) => {
  try {
    const { consumerNo } = req.user;
    const date  = req.query.date ? new Date(req.query.date) : new Date();
    const start = new Date(date); start.setHours(0,0,0,0);
    const end   = new Date(date); end.setHours(23,59,59,999);
 
    const readings = await Reading.find({
      consumerNo,
      timestamp: { $gte: start, $lte: end },
    }).sort({ timestamp: 1 }).lean();
 
    res.json({ readings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
// ── GET /api/readings/monthly-summary ────────────────────────────────────────
router.get('/monthly-summary', auth, async (req, res) => {
  try {
    const { consumerNo } = req.user;
    const since = new Date();
    since.setMonth(since.getMonth() - 12);
 
    const agg = await Reading.aggregate([
      { $match: { consumerNo, timestamp: { $gte: since } } },
      {
        $group: {
          _id: {
            year:  { $year:  '$timestamp' },
            month: { $month: '$timestamp' },
          },
          maxEnergy: { $max: '$energy' },
          minEnergy: { $min: '$energy' },
          avgPower:  { $avg: '$power' },
          avgPF:     { $avg: '$powerFactor' },
          count:     { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);
 
    const summary = agg.map(m => ({
      label:    `${m._id.year}-${String(m._id.month).padStart(2,'0')}`,
      kwh:      +(m.maxEnergy - m.minEnergy).toFixed(2),
      avgPower: +m.avgPower.toFixed(1),
      avgPF:    m.avgPF ? +m.avgPF.toFixed(3) : null,
      readings: m.count,
    }));
 
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
// ── POST /api/readings/mock-start ─────────────────────────────────────────────
router.post('/mock-start', auth, async (req, res) => {
  const { consumerNo } = req.user;
 
  if (!req.app.locals.mockIntervals) req.app.locals.mockIntervals = {};
 
  if (req.app.locals.mockIntervals[consumerNo]) {
    clearInterval(req.app.locals.mockIntervals[consumerNo]);
  }
 
  req.app.locals.mockIntervals[consumerNo] = setInterval(async () => {
    try {
      const v  = +(231 + (Math.random() - 0.5) * 1.5).toFixed(1);
      const a  = +(2.5  + (Math.random() - 0.5) * 0.3).toFixed(2);
      const pf = +(0.92 + (Math.random() - 0.5) * 0.02).toFixed(2);
      const w  = +(v * a * pf).toFixed(1);
 
      const last   = await Reading.findOne({ consumerNo }).sort({ timestamp: -1 });
      const energy = +((last?.energy || 0) + (w / 1000 / 720)).toFixed(4);
 
      const reading = await Reading.create({
        consumerNo,
        voltage: v, current: a, power: w, energy,
        frequency: 50, powerFactor: pf,
        reactivePower: +(w * Math.tan(Math.acos(pf))).toFixed(1),
        source: 'mock',
      });
 
      if (req.app.locals.wsBroadcast) {
        req.app.locals.wsBroadcast(consumerNo, { type: 'READING', data: reading });
      }
    } catch (e) {
      console.error('Mock interval error:', e.message);
    }
  }, 5000);
 
  res.json({ ok: true, message: 'Server-side mock started — saving to MongoDB every 5s' });
});
 
// ── POST /api/readings/mock-stop ──────────────────────────────────────────────
router.post('/mock-stop', auth, async (req, res) => {
  const { consumerNo } = req.user;
  if (req.app.locals.mockIntervals?.[consumerNo]) {
    clearInterval(req.app.locals.mockIntervals[consumerNo]);
    delete req.app.locals.mockIntervals[consumerNo];
  }
  res.json({ ok: true, message: 'Mock stopped' });
});
 
module.exports = router;