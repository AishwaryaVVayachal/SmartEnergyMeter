require('dotenv').config();
const express   = require('express');
const http      = require('http');
const { WebSocketServer } = require('ws');
const mongoose  = require('mongoose');
const cors      = require('cors');
 
const authRoutes     = require('./routes/auth');
const readingRoutes  = require('./routes/readings');
const billRoutes     = require('./routes/bills');
const adminRoutes    = require('./admin/index');
 
const app    = express();
const server = http.createServer(app);
 
// ── Cookie parser (simple, no dependency needed) ──────────────────────────────
app.use((req, res, next) => {
  req.cookies = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach(pair => {
    const [k, ...v] = pair.trim().split('=');
    if (k) req.cookies[k.trim()] = v.join('=').trim();
  });
  next();
});
 
// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*', credentials: true }));app.use(express.json());
 
// ── Admin Dashboard (server-side rendered) 
app.use('/admin', adminRoutes);
 
// ── REST API Routes ───────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/readings', readingRoutes);
app.use('/api/bills',    billRoutes);
 
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date() }));
 
// ── Root redirect to admin ────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/admin'));
 
// ── WebSocket Server ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });
const subscribers = new Map();
 
wss.on('connection', (ws) => {
  let consumerNo = null;
 
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'SUBSCRIBE' && msg.consumerNo) {
        consumerNo = msg.consumerNo;
        if (!subscribers.has(consumerNo)) subscribers.set(consumerNo, new Set());
        subscribers.get(consumerNo).add(ws);
        ws.send(JSON.stringify({ type: 'SUBSCRIBED', consumerNo }));
      }
    } catch (_) {}
  });
 
  ws.on('close', () => {
    if (consumerNo && subscribers.has(consumerNo)) {
      subscribers.get(consumerNo).delete(ws);
    }
  });
});
 
app.locals.wsBroadcast = (consumerNo, payload) => {
  const clients = subscribers.get(consumerNo);
  if (!clients || clients.size === 0) return;
  const msg = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
};
 
// ── MongoDB + Start ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
 
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    server.listen(PORT, () =>
      console.log(`🚀 Server running on http://localhost:${PORT}`)
    );
  })
  .catch((err) => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });