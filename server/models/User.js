const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  // ── Login credentials ─────────────────────────────────
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },

  // ── Consumer profile (shown on dashboard after login) ─
  name:         { type: String, required: true },
  consumerNo:   { type: String, required: true, unique: true }, // e.g. 170213894059
  meterNo:      { type: String, required: true },               // e.g. 05029738
  phone:        { type: String, default: '' },
  address:      { type: String, default: '' },
  tariff:       { type: String, default: '090/LT Res 1-Phase' },
  sanctionLoad: { type: Number, default: 4 },                   // kW
  supplyDate:   { type: String, default: '' },
  circle:       { type: String, default: '' },
  division:     { type: String, default: '' },

  // ── ESP32 link ────────────────────────────────────────
  // each user is linked to one ESP32 device
  espDeviceId:  { type: String, default: '' },  // set when ESP first connects

  createdAt: { type: Date, default: Date.now },
});

// Hash password before saving
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Compare password helper
UserSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = mongoose.model('User', UserSchema);
