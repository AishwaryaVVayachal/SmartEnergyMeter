const express = require('express');
const Bill    = require('../models/Bill');
const Reading = require('../models/Reading');
const auth    = require('../middleware/auth');

const router = express.Router();

// ── GET /api/bills ────────────────────────────────────────────────────────────
// All bills for this consumer (newest first)
router.get('/', auth, async (req, res) => {
  try {
    const bills = await Bill.find({ consumerNo: req.user.consumerNo })
      .sort({ billMonth: -1 }).lean();
    res.json({ bills });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/bills/current ────────────────────────────────────────────────────
// Current month's bill (or null if not generated yet)
router.get('/current', auth, async (req, res) => {
  try {
    const { consumerNo } = req.user;
    const now   = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const bill  = await Bill.findOne({ consumerNo, billMonth: month }).lean();
    res.json({ bill, billGenerated: !!bill });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/bills/generate ──────────────────────────────────────────────────
// Generates a bill for a given month using energy readings
// Body: { month: 'YYYY-MM' }   (admin / auto-trigger at month end)
router.post('/generate', auth, async (req, res) => {
  try {
    const { consumerNo } = req.user;
    const month = req.body.month || (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    })();

    const [year, mon] = month.split('-').map(Number);
    const start = new Date(year, mon-1, 1);
    const end   = new Date(year, mon,   1);

    // Get first and last energy reading for the month
    const first = await Reading.findOne({ consumerNo, timestamp: { $gte: start, $lt: end } })
      .sort({ timestamp:  1 }).lean();
    const last  = await Reading.findOne({ consumerNo, timestamp: { $gte: start, $lt: end } })
      .sort({ timestamp: -1 }).lean();

    if (!first || !last)
      return res.status(400).json({ error: 'No readings found for this month' });

    const units = +(last.energy - first.energy).toFixed(2);

    // ── Simple MSEDCL LT Res tariff calculation ────────────────────────────
    // 0–100 units:  ₹3.25/unit
    // 101–300 units: ₹5.45/unit
    // >300 units:   ₹7.25/unit
    let energyCharge = 0;
    if (units <= 100)       energyCharge = units * 3.25;
    else if (units <= 300)  energyCharge = 100*3.25 + (units-100)*5.45;
    else                    energyCharge = 100*3.25 + 200*5.45 + (units-300)*7.25;

    const fixedCharge  = 40;   // ₹40/month fixed
    const lpsc         = +(energyCharge * 0.01).toFixed(2);   // 1% late payment surcharge
    const divisionDuty = +(energyCharge * 0.06).toFixed(2);   // 6%
    const total        = +(energyCharge + fixedCharge + lpsc + divisionDuty).toFixed(2);

    const dueDate = new Date(year, mon, 10);  // 10th of next month

    const bill = await Bill.findOneAndUpdate(
      { consumerNo, billMonth: month },
      {
        consumerNo, billMonth: month,
        openingRead:   first.energy,
        closingRead:   last.energy,
        unitsConsumed: units,
        billAmount:    total,
        lateFine:      20,
        dueDate:       dueDate.toLocaleDateString('en-IN'),
        breakdown: { energyCharge, fixedCharge, lpsc, divisionDuty, arrears: 0 },
      },
      { upsert: true, new: true }
    );

    res.json({ bill });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/bills/download/:month ───────────────────────────────────────────
// Returns bill data as JSON; client renders it into a printable page / PDF
router.get('/download/:month', auth, async (req, res) => {
  try {
    const { consumerNo } = req.user;
    const bill = await Bill.findOne({ consumerNo, billMonth: req.params.month }).lean();
    if (!bill) return res.status(404).json({ error: 'Bill not found for this month' });
    res.json({ bill });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
