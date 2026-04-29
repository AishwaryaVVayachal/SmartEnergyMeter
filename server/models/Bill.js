const mongoose = require('mongoose');

const BillSchema = new mongoose.Schema({
  consumerNo:   { type: String, required: true, index: true },
  billMonth:    { type: String, required: true },  // 'YYYY-MM'  e.g. '2024-10'
  billNo:       { type: String, default: '' },

  // readings snapshot
  openingRead:  { type: Number, default: 0 },
  closingRead:  { type: Number, default: 0 },
  unitsConsumed:{ type: Number, required: true },
  mf:           { type: Number, default: 1 },

  // billing
  billAmount:   { type: Number, required: true },
  dueDate:      { type: String, default: '' },
  lateFine:     { type: Number, default: 20 },
  isPaid:       { type: Boolean, default: false },
  paidOn:       { type: Date, default: null },

  // tariff breakdown (optional, for detailed bill view)
  breakdown: {
    energyCharge:    { type: Number, default: 0 },
    fixedCharge:     { type: Number, default: 0 },
    lpsc:            { type: Number, default: 0 },
    divisionDuty:    { type: Number, default: 0 },
    arrears:         { type: Number, default: 0 },
  },

  generatedAt: { type: Date, default: Date.now },
});

// compound unique index — one bill per consumer per month
BillSchema.index({ consumerNo: 1, billMonth: 1 }, { unique: true });

module.exports = mongoose.model('Bill', BillSchema);
