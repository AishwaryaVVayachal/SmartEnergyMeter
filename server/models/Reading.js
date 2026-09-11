const mongoose = require('mongoose');
 
const ReadingSchema = new mongoose.Schema({
  // which consumer this reading belongs to
  consumerNo: { type: String, required: true, index: true },
 
  // ── Electrical readings from ESP32 + sensor IC (PZEM-004T / ACS712) ──
  voltage:     { type: Number, required: true },   // V
  current:     { type: Number, required: true },   // A
  power:       { type: Number, required: true },   // W  (active power)
  energy:      { type: Number, required: true },   // kWh (cumulative)
  frequency:   { type: Number, default: 50 },      // Hz
  powerFactor: { type: Number, default: null },     // 0.00 – 1.00
  reactivePower: { type: Number, default: null },  // VAR
 
  // ── Source flag ───────────────────────────────────────
  // 'esp'      = real hardware posting data
  // 'sim'      = online simulator (Wokwi / custom)
  // 'mock'     = server-generated placeholder (no device connected)
  source: { type: String, enum: ['esp','sim','mock'], default: 'mock' },
 
  timestamp: { type: Date, default: Date.now },
});
 
// TTL: auto-delete raw readings older than 180 days (keeps DB small)
ReadingSchema.index({ timestamp: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });
 
module.exports = mongoose.model('Reading', ReadingSchema);