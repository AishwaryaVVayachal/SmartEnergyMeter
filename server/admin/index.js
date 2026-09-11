const express  = require('express');
const router   = express.Router();
const User     = require('../models/User');
const Reading  = require('../models/Reading');
const Bill     = require('../models/Bill');
 
// ── Simple session via signed cookie ─────────────────────────────────────────
// We use a plain object in memory (fine for single-server projects)
const sessions = new Set();
 
function requireAdmin(req, res, next) {
  const token = req.cookies?.admin_token;
  if (token && sessions.has(token)) return next();
  res.redirect('/admin/login');
}
 
function genToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
 
// ── LOGIN PAGE ────────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  res.send(loginPage(''));
});
 
router.post('/login', express.urlencoded({ extended: true }), (req, res) => {
  const { username, password } = req.body;
  console.log(
  'LOGIN DEBUG:',
  JSON.stringify(username),
  JSON.stringify(process.env.ADMIN_USERNAME),
  password === process.env.ADMIN_PASSWORD
);  
  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    const token = genToken();
    sessions.add(token);
    res.setHeader('Set-Cookie', `admin_token=${token}; HttpOnly; Path=/admin; Max-Age=86400`);
    res.redirect('/admin');
  } else {
    res.send(loginPage('Invalid username or password'));
  }
});
 
router.get('/logout', (req, res) => {
  const token = req.cookies?.admin_token;
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'admin_token=; Max-Age=0; Path=/admin');
  res.redirect('/admin/login');
});
 
// ── DASHBOARD HOME ────────────────────────────────────────────────────────────
router.get('/', requireAdmin, async (req, res) => {
  try {
    const [
      totalUsers, totalReadings, totalBills,
      latestReadings, recentUsers, unpaidBills,
    ] = await Promise.all([
      User.countDocuments(),
      Reading.countDocuments(),
      Bill.countDocuments(),
      Reading.find().sort({ timestamp: -1 }).limit(5).lean(),
      User.find().sort({ createdAt: -1 }).limit(5).select('-password').lean(),
      Bill.find({ isPaid: false }).sort({ generatedAt: -1 }).limit(5).lean(),
    ]);
 
    // readings per day last 7 days
    const since7 = new Date(); since7.setDate(since7.getDate() - 7);
    const dailyCounts = await Reading.aggregate([
      { $match: { timestamp: { $gte: since7 } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
        count: { $sum: 1 },
        avgVoltage: { $avg: '$voltage' },
        avgPower: { $avg: '$power' },
      }},
      { $sort: { _id: 1 } },
    ]);
 
    res.send(dashboardPage({
      totalUsers, totalReadings, totalBills,
      latestReadings, recentUsers, unpaidBills, dailyCounts,
    }));
  } catch (err) {
    res.send(errorPage(err.message));
  }
});
 
// ── ALL USERS ─────────────────────────────────────────────────────────────────
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 }).lean();
    // get reading count and last reading for each user
    const enriched = await Promise.all(users.map(async u => {
      const [count, last, billCount] = await Promise.all([
        Reading.countDocuments({ consumerNo: u.consumerNo }),
        Reading.findOne({ consumerNo: u.consumerNo }).sort({ timestamp: -1 }).lean(),
        Bill.countDocuments({ consumerNo: u.consumerNo }),
      ]);
      return { ...u, readingCount: count, lastReading: last, billCount };
    }));
    res.send(usersPage(enriched));
  } catch (err) {
    res.send(errorPage(err.message));
  }
});
 
// ── SINGLE USER DETAIL ────────────────────────────────────────────────────────
router.get('/users/:consumerNo', requireAdmin, async (req, res) => {
  try {
    const { consumerNo } = req.params;
    const [user, readings, bills] = await Promise.all([
      User.findOne({ consumerNo }).select('-password').lean(),
      Reading.find({ consumerNo }).sort({ timestamp: -1 }).limit(100).lean(),
      Bill.find({ consumerNo }).sort({ billMonth: -1 }).lean(),
    ]);
    if (!user) return res.send(errorPage('User not found'));
    res.send(userDetailPage(user, readings, bills));
  } catch (err) {
    res.send(errorPage(err.message));
  }
});
 
// ── ALL READINGS ──────────────────────────────────────────────────────────────
router.get('/readings', requireAdmin, async (req, res) => {
  try {
    const page  = parseInt(req.query.page) || 1;
    const limit = 50;
    const skip  = (page - 1) * limit;
    const filter = req.query.consumer ? { consumerNo: req.query.consumer } : {};
 
    const [readings, total] = await Promise.all([
      Reading.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).lean(),
      Reading.countDocuments(filter),
    ]);
    res.send(readingsPage(readings, total, page, limit, req.query.consumer || ''));
  } catch (err) {
    res.send(errorPage(err.message));
  }
});
 
// ── ALL BILLS ─────────────────────────────────────────────────────────────────
router.get('/bills', requireAdmin, async (req, res) => {
  try {
    const bills = await Bill.find().sort({ generatedAt: -1 }).lean();
    res.send(billsPage(bills));
  } catch (err) {
    res.send(errorPage(err.message));
  }
});
 
// ─────────────────────────────────────────────────────────────────────────────
// HTML TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────
 
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
  :root {
    --navy:#0F2044;--blue:#1A4FBD;--green:#166534;--amber:#92400E;
    --red:#991B1B;--teal:#0E7490;--purple:#5B21B6;
    --ink:#0F172A;--ink2:#334155;--ink3:#64748B;--ink4:#94A3B8;
    --line:#E2E8F0;--bg:#F8FAFC;--card:#fff;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Sora',sans-serif;background:var(--bg);color:var(--ink);font-size:13px}
  a{color:var(--blue);text-decoration:none}
  a:hover{text-decoration:underline}
 
  .topbar{background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 28px;height:54px;position:sticky;top:0;z-index:100}
  .brand{display:flex;align-items:center;gap:10px}
  .brand-icon{width:30px;height:30px;background:#fff1;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:16px}
  .brand-name{font-size:14px;font-weight:700}
  .brand-sub{font-size:10px;color:#94A3B8}
  .nav-links{display:flex;gap:4px}
  .nav-link{color:#94A3B8;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:500;transition:all .15s}
  .nav-link:hover,.nav-link.active{background:#fff1;color:#fff;text-decoration:none}
  .nav-right{display:flex;align-items:center;gap:10px}
  .admin-badge{background:#5B21B622;border:1px solid #7C3AED;color:#C4B5FD;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:600}
  .logout{background:transparent;border:1px solid #ffffff33;color:#fff;border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer;font-family:'Sora',sans-serif}
 
  .page{max-width:1400px;margin:0 auto;padding:24px}
  .page-title{font-size:22px;font-weight:700;color:var(--ink);margin-bottom:4px;letter-spacing:-.4px}
  .page-sub{font-size:12px;color:var(--ink3);margin-bottom:24px}
 
  .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px}
  .kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;position:relative;overflow:hidden}
  .kpi-bar{position:absolute;top:0;left:0;right:0;height:3px}
  .kpi-label{font-size:10px;color:var(--ink4);text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:8px}
  .kpi-val{font-size:32px;font-weight:300;color:var(--ink);font-family:'JetBrains Mono',monospace;line-height:1}
  .kpi-sub{font-size:11px;color:var(--ink3);margin-top:6px}
 
  .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
  .grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:16px}
 
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:16px}
  .card-head{padding:14px 18px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between}
  .card-title{font-size:13px;font-weight:600;color:var(--ink)}
  .card-sub{font-size:11px;color:var(--ink4)}
  .card-body{padding:0}
 
  table{width:100%;border-collapse:collapse}
  th{text-align:left;padding:10px 14px;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:var(--ink4);border-bottom:1px solid var(--line);font-weight:700;background:#F8FAFC}
  td{padding:10px 14px;border-bottom:1px solid var(--line);color:var(--ink2);font-size:12px}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:#F8FAFC}
  .mono{font-family:'JetBrains Mono',monospace}
 
  .badge{display:inline-flex;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700}
  .b-green{background:#DCFCE7;color:#166534}
  .b-red{background:#FEE2E2;color:#991B1B}
  .b-amber{background:#FEF3C7;color:#92400E}
  .b-blue{background:#EAF0FB;color:#1A4FBD}
  .b-purple{background:#EDE9FE;color:#5B21B6}
 
  .btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:7px;font-size:12px;font-weight:600;border:none;cursor:pointer;font-family:'Sora',sans-serif;text-decoration:none}
  .btn-primary{background:var(--blue);color:#fff}
  .btn-sm{padding:4px 10px;font-size:11px}
 
  .search-bar{display:flex;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);background:#F8FAFC}
  .search-bar input{flex:1;border:1px solid var(--line);border-radius:7px;padding:8px 12px;font-size:12px;font-family:'Sora',sans-serif}
  .search-bar button{background:var(--blue);color:#fff;border:none;border-radius:7px;padding:8px 16px;font-size:12px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif}
 
  .pagination{display:flex;align-items:center;gap:8px;padding:14px 18px;border-top:1px solid var(--line)}
  .page-btn{padding:5px 12px;border:1px solid var(--line);border-radius:6px;font-size:12px;font-weight:500;color:var(--blue);text-decoration:none}
  .page-btn.active{background:var(--blue);color:#fff;border-color:var(--blue)}
 
  .stat-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px dashed var(--line)}
  .stat-row:last-child{border-bottom:none}
  .stat-key{font-size:11px;color:var(--ink3)}
  .stat-val{font-size:12px;font-weight:600;color:var(--ink);font-family:'JetBrains Mono',monospace}
 
  .reading-spark{display:inline-block;width:60px;height:20px;vertical-align:middle}
 
  .user-avatar{width:32px;height:32px;border-radius:50%;background:var(--navy);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;margin-right:8px;vertical-align:middle}
 
  .detail-header{background:var(--navy);color:#fff;padding:24px 28px;margin-bottom:20px;border-radius:12px}
  .detail-name{font-size:22px;font-weight:700;margin-bottom:4px}
  .detail-meta{font-size:12px;color:#94A3B8}
  .detail-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:0;margin-top:16px;border-top:1px solid #ffffff15;padding-top:16px}
  .detail-cell{padding:0 16px}
  .detail-cell:first-child{padding-left:0}
  .detail-cell-label{font-size:9px;color:#64748B;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px}
  .detail-cell-val{font-size:13px;font-weight:600;color:#E2E8F0}
 
  .empty{padding:32px;text-align:center;color:var(--ink4);font-size:13px}
  .error-box{background:#FEE2E2;border:1px solid #FCA5A5;border-radius:10px;padding:20px;color:#991B1B;margin:20px 0}
`;
 
function layout(title, navActive, content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title} — SmartEnergy Admin</title>
<style>${CSS}</style>
</head>
<body>
<div class="topbar">
  <div class="brand">
    <div class="brand-icon">⚡</div>
    <div>
      <div class="brand-name">SmartEnergy Admin</div>
      <div class="brand-sub">Server Management Dashboard</div>
    </div>
  </div>
  <div class="nav-links">
    <a href="/admin" class="nav-link ${navActive==='home'?'active':''}">Overview</a>
    <a href="/admin/users" class="nav-link ${navActive==='users'?'active':''}">Users</a>
    <a href="/admin/readings" class="nav-link ${navActive==='readings'?'active':''}">Readings</a>
    <a href="/admin/bills" class="nav-link ${navActive==='bills'?'active':''}">Bills</a>
  </div>
  <div class="nav-right">
    <div class="admin-badge">● ADMIN</div>
    <a href="/admin/logout"><button class="logout">Logout</button></a>
  </div>
</div>
${content}
</body>
</html>`;
}
 
// ── LOGIN PAGE HTML ───────────────────────────────────────────────────────────
function loginPage(error) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Admin Login — SmartEnergy</title>
<style>
${CSS}
.login-bg{min-height:100vh;background:linear-gradient(135deg,#0F2044,#1A4FBD);display:flex;align-items:center;justify-content:center}
.login-card{background:#fff;border-radius:16px;padding:40px;width:100%;max-width:400px;box-shadow:0 24px 60px rgba(15,32,68,.4)}
.login-icon{font-size:36px;text-align:center;margin-bottom:8px}
.login-title{font-size:20px;font-weight:700;text-align:center;color:#0F172A;margin-bottom:2px}
.login-sub{font-size:12px;color:#94A3B8;text-align:center;margin-bottom:28px}
.field{display:flex;flex-direction:column;gap:5px;margin-bottom:14px}
.field label{font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.5px}
.field input{border:1px solid #E2E8F0;border-radius:8px;padding:10px 12px;font-size:13px;font-family:'Sora',sans-serif;outline:none}
.field input:focus{border-color:#1A4FBD}
.login-btn{width:100%;background:#1A4FBD;color:#fff;border:none;border-radius:8px;padding:12px;font-size:14px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;margin-top:4px}
.login-btn:hover{background:#1640A0}
.login-error{background:#FEE2E2;color:#991B1B;border-radius:8px;padding:10px 14px;font-size:12px;font-weight:500;margin-bottom:14px}
.admin-note{text-align:center;font-size:11px;color:#94A3B8;margin-top:16px}
</style>
</head>
<body>
<div class="login-bg">
  <div class="login-card">
    <div class="login-icon">⚡</div>
    <div class="login-title">SmartEnergy Admin</div>
    <div class="login-sub">Server Management Dashboard</div>
    ${error ? `<div class="login-error">${error}</div>` : ''}
    <form method="POST" action="/admin/login">
      <div class="field"><label>Username</label><input name="username" type="text" required autofocus/></div>
      <div class="field"><label>Password</label><input name="password" type="password" required/></div>
      <button type="submit" class="login-btn">Login to Admin →</button>
    </form>
    <div class="admin-note">Set credentials in server/.env</div>
  </div>
</div>
</body>
</html>`;
}
 
// ── DASHBOARD HOME HTML ───────────────────────────────────────────────────────
function dashboardPage({ totalUsers, totalReadings, totalBills, latestReadings, recentUsers, unpaidBills, dailyCounts }) {
  return layout('Overview', 'home', `
<div class="page">
  <div class="page-title">System Overview</div>
  <div class="page-sub">Real-time server and database status</div>
 
  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-bar" style="background:#1A4FBD"></div>
      <div class="kpi-label">Total Users</div>
      <div class="kpi-val">${totalUsers}</div>
      <div class="kpi-sub">Registered consumers</div>
    </div>
    <div class="kpi">
      <div class="kpi-bar" style="background:#166534"></div>
      <div class="kpi-label">Total Readings</div>
      <div class="kpi-val">${totalReadings.toLocaleString()}</div>
      <div class="kpi-sub">Stored in MongoDB</div>
    </div>
    <div class="kpi">
      <div class="kpi-bar" style="background:#5B21B6"></div>
      <div class="kpi-label">Total Bills</div>
      <div class="kpi-val">${totalBills}</div>
      <div class="kpi-sub">Generated bills</div>
    </div>
    <div class="kpi">
      <div class="kpi-bar" style="background:#92400E"></div>
      <div class="kpi-label">Unpaid Bills</div>
      <div class="kpi-val">${unpaidBills.length}</div>
      <div class="kpi-sub">Pending payments</div>
    </div>
  </div>
 
  <div class="grid-2">
    <!-- Recent Users -->
    <div class="card">
      <div class="card-head">
        <div><div class="card-title">Recent Users</div><div class="card-sub">Latest registrations</div></div>
        <a href="/admin/users" class="btn btn-primary btn-sm">View All</a>
      </div>
      <div class="card-body">
        <table>
          <thead><tr><th>Name</th><th>Consumer No.</th><th>Meter No.</th><th>Registered</th></tr></thead>
          <tbody>
            ${recentUsers.length === 0 ? `<tr><td colspan="4" class="empty">No users yet</td></tr>` :
              recentUsers.map(u => `
              <tr>
                <td><span class="user-avatar">${u.name[0]}</span>${u.name}</td>
                <td class="mono">${u.consumerNo}</td>
                <td class="mono">${u.meterNo}</td>
                <td>${new Date(u.createdAt).toLocaleDateString('en-IN')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
 
    <!-- Latest Readings -->
    <div class="card">
      <div class="card-head">
        <div><div class="card-title">Latest Readings</div><div class="card-sub">Most recent from all consumers</div></div>
        <a href="/admin/readings" class="btn btn-primary btn-sm">View All</a>
      </div>
      <div class="card-body">
        <table>
          <thead><tr><th>Consumer</th><th>Voltage</th><th>Current</th><th>Power</th><th>Source</th><th>Time</th></tr></thead>
          <tbody>
            ${latestReadings.length === 0 ? `<tr><td colspan="6" class="empty">No readings yet</td></tr>` :
              latestReadings.map(r => `
              <tr>
                <td class="mono">${r.consumerNo}</td>
                <td class="mono">${r.voltage}V</td>
                <td class="mono">${r.current}A</td>
                <td class="mono">${r.power}W</td>
                <td><span class="badge ${r.source==='esp'?'b-green':r.source==='sim'?'b-blue':'b-amber'}">${r.source}</span></td>
                <td>${new Date(r.timestamp).toLocaleTimeString('en-IN')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>
 
  <!-- Daily readings chart (last 7 days) -->
  <div class="card">
    <div class="card-head">
      <div><div class="card-title">Readings Per Day — Last 7 Days</div><div class="card-sub">All consumers combined</div></div>
    </div>
    <div class="card-body" style="padding:20px">
      <div style="display:flex;align-items:flex-end;gap:12px;height:120px">
        ${dailyCounts.length === 0 ? '<div class="empty" style="width:100%">No data yet</div>' :
          dailyCounts.map(d => {
            const max = Math.max(...dailyCounts.map(x => x.count));
            const h   = Math.round((d.count / max) * 100);
            return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
              <div style="font-size:10px;color:#64748B">${d.count}</div>
              <div style="width:100%;height:${h}%;background:#1A4FBD;border-radius:4px 4px 0 0;min-height:4px"></div>
              <div style="font-size:9px;color:#94A3B8">${d._id.slice(5)}</div>
            </div>`;
          }).join('')}
      </div>
    </div>
  </div>
 
  <!-- Unpaid Bills -->
  <div class="card">
    <div class="card-head">
      <div><div class="card-title">Unpaid Bills</div><div class="card-sub">Consumers with pending payments</div></div>
      <a href="/admin/bills" class="btn btn-primary btn-sm">View All Bills</a>
    </div>
    <div class="card-body">
      <table>
        <thead><tr><th>Consumer No.</th><th>Month</th><th>Units</th><th>Amount</th><th>Due Date</th><th>Status</th></tr></thead>
        <tbody>
          ${unpaidBills.length === 0 ? `<tr><td colspan="6" class="empty">All bills paid ✓</td></tr>` :
            unpaidBills.map(b => `
            <tr>
              <td class="mono">${b.consumerNo}</td>
              <td>${b.billMonth}</td>
              <td class="mono">${b.unitsConsumed} kWh</td>
              <td class="mono" style="font-weight:700;color:#991B1B">₹ ${b.billAmount}</td>
              <td style="color:#92400E">${b.dueDate}</td>
              <td><span class="badge b-red">Unpaid</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>
</div>`);
}
 
// ── USERS PAGE HTML ───────────────────────────────────────────────────────────
function usersPage(users) {
  return layout('Users', 'users', `
<div class="page">
  <div class="page-title">All Users</div>
  <div class="page-sub">${users.length} registered consumers</div>
  <div class="card">
    <div class="card-body">
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Consumer No.</th><th>Meter No.</th>
            <th>Tariff</th><th>Sanction Load</th><th>Readings</th>
            <th>Bills</th><th>Last Reading</th><th>Registered</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${users.length === 0 ? `<tr><td colspan="10" class="empty">No users registered yet</td></tr>` :
            users.map(u => `
            <tr>
              <td><span class="user-avatar">${u.name[0]}</span><strong>${u.name}</strong><br><span style="color:#94A3B8;font-size:10px">${u.email}</span></td>
              <td class="mono">${u.consumerNo}</td>
              <td class="mono">${u.meterNo}</td>
              <td>${u.tariff || '—'}</td>
              <td>${u.sanctionLoad} kW</td>
              <td class="mono">${u.readingCount.toLocaleString()}</td>
              <td class="mono">${u.billCount}</td>
              <td>
                ${u.lastReading ? `
                  <span class="mono">${u.lastReading.voltage}V / ${u.lastReading.current}A</span><br>
                  <span style="font-size:10px;color:#94A3B8">${new Date(u.lastReading.timestamp).toLocaleString('en-IN')}</span>
                  <span class="badge ${u.lastReading.source==='esp'?'b-green':'b-amber'} btn-sm">${u.lastReading.source}</span>
                ` : '<span style="color:#94A3B8">No readings yet</span>'}
              </td>
              <td>${new Date(u.createdAt).toLocaleDateString('en-IN')}</td>
              <td><a href="/admin/users/${u.consumerNo}" class="btn btn-primary btn-sm">View →</a></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>
</div>`);
}
 
// ── USER DETAIL PAGE HTML ─────────────────────────────────────────────────────
function userDetailPage(user, readings, bills) {
  return layout(`${user.name}`, 'users', `
<div class="page">
  <div style="margin-bottom:16px"><a href="/admin/users">← Back to Users</a></div>
 
  <div class="detail-header">
    <div class="detail-name">${user.name}</div>
    <div class="detail-meta">${user.email} &nbsp;·&nbsp; ${user.address || 'No address'}</div>
    <div class="detail-grid">
      <div class="detail-cell"><div class="detail-cell-label">Consumer No.</div><div class="detail-cell-val">${user.consumerNo}</div></div>
      <div class="detail-cell"><div class="detail-cell-label">Meter No.</div><div class="detail-cell-val">${user.meterNo}</div></div>
      <div class="detail-cell"><div class="detail-cell-label">Tariff</div><div class="detail-cell-val">${user.tariff || '—'}</div></div>
      <div class="detail-cell"><div class="detail-cell-label">Sanction Load</div><div class="detail-cell-val">${user.sanctionLoad} kW</div></div>
    </div>
  </div>
 
  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-bar" style="background:#1A4FBD"></div>
      <div class="kpi-label">Total Readings</div>
      <div class="kpi-val">${readings.length >= 100 ? '100+' : readings.length}</div>
      <div class="kpi-sub">Last 100 shown</div>
    </div>
    <div class="kpi">
      <div class="kpi-bar" style="background:#166534"></div>
      <div class="kpi-label">Avg Voltage</div>
      <div class="kpi-val">${readings.length ? (readings.reduce((s,r)=>s+r.voltage,0)/readings.length).toFixed(1) : '—'}<span style="font-size:14px;color:#94A3B8"> V</span></div>
    </div>
    <div class="kpi">
      <div class="kpi-bar" style="background:#F59E0B"></div>
      <div class="kpi-label">Avg Power</div>
      <div class="kpi-val">${readings.length ? Math.round(readings.reduce((s,r)=>s+r.power,0)/readings.length) : '—'}<span style="font-size:14px;color:#94A3B8"> W</span></div>
    </div>
    <div class="kpi">
      <div class="kpi-bar" style="background:#5B21B6"></div>
      <div class="kpi-label">Total Bills</div>
      <div class="kpi-val">${bills.length}</div>
      <div class="kpi-sub">₹ ${bills.reduce((s,b)=>s+b.billAmount,0).toFixed(0)} total</div>
    </div>
  </div>
 
  <div class="grid-2">
    <!-- Readings -->
    <div class="card">
      <div class="card-head"><div class="card-title">Latest Readings</div><div class="card-sub">Last 100 readings</div></div>
      <div class="card-body" style="max-height:400px;overflow-y:auto">
        <table>
          <thead><tr><th>Time</th><th>Voltage</th><th>Current</th><th>Power</th><th>Energy</th><th>PF</th><th>Source</th></tr></thead>
          <tbody>
            ${readings.length === 0 ? `<tr><td colspan="7" class="empty">No readings yet</td></tr>` :
              readings.map(r => `
              <tr>
                <td style="font-size:11px">${new Date(r.timestamp).toLocaleString('en-IN')}</td>
                <td class="mono">${r.voltage}V</td>
                <td class="mono">${r.current}A</td>
                <td class="mono">${r.power}W</td>
                <td class="mono">${r.energy} kWh</td>
                <td class="mono">${r.powerFactor ?? '—'}</td>
                <td><span class="badge ${r.source==='esp'?'b-green':r.source==='sim'?'b-blue':'b-amber'}">${r.source}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
 
    <!-- Bills -->
    <div class="card">
      <div class="card-head"><div class="card-title">Bills</div><div class="card-sub">All generated bills</div></div>
      <div class="card-body">
        <table>
          <thead><tr><th>Month</th><th>Units</th><th>Amount</th><th>Due Date</th><th>Status</th></tr></thead>
          <tbody>
            ${bills.length === 0 ? `<tr><td colspan="5" class="empty">No bills generated yet</td></tr>` :
              bills.map(b => `
              <tr>
                <td>${b.billMonth}</td>
                <td class="mono">${b.unitsConsumed} kWh</td>
                <td class="mono" style="font-weight:700">₹ ${b.billAmount}</td>
                <td>${b.dueDate || '—'}</td>
                <td><span class="badge ${b.isPaid?'b-green':'b-red'}">${b.isPaid?'Paid':'Unpaid'}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>`);
}
 
// ── READINGS PAGE HTML ────────────────────────────────────────────────────────
function readingsPage(readings, total, page, limit, consumer) {
  const totalPages = Math.ceil(total / limit);
  return layout('Readings', 'readings', `
<div class="page">
  <div class="page-title">All Readings</div>
  <div class="page-sub">${total.toLocaleString()} total readings in database</div>
  <div class="card">
    <form method="GET" action="/admin/readings" class="search-bar">
      <input name="consumer" placeholder="Filter by Consumer No..." value="${consumer}"/>
      <button type="submit">Search</button>
      ${consumer ? `<a href="/admin/readings" class="btn" style="background:#F1F5F9;color:#334155">Clear</a>` : ''}
    </form>
    <div class="card-body">
      <table>
        <thead><tr><th>Time</th><th>Consumer No.</th><th>Voltage</th><th>Current</th><th>Power</th><th>Energy</th><th>Frequency</th><th>Power Factor</th><th>Source</th></tr></thead>
        <tbody>
          ${readings.length === 0 ? `<tr><td colspan="9" class="empty">No readings found</td></tr>` :
            readings.map(r => `
            <tr>
              <td style="font-size:11px;white-space:nowrap">${new Date(r.timestamp).toLocaleString('en-IN')}</td>
              <td><a href="/admin/users/${r.consumerNo}" class="mono">${r.consumerNo}</a></td>
              <td class="mono">${r.voltage} V</td>
              <td class="mono">${r.current} A</td>
              <td class="mono">${r.power} W</td>
              <td class="mono">${r.energy} kWh</td>
              <td class="mono">${r.frequency} Hz</td>
              <td class="mono">${r.powerFactor ?? '—'}</td>
              <td><span class="badge ${r.source==='esp'?'b-green':r.source==='sim'?'b-blue':'b-amber'}">${r.source}</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="pagination">
      ${page > 1 ? `<a href="/admin/readings?page=${page-1}&consumer=${consumer}" class="page-btn">← Prev</a>` : ''}
      <span style="font-size:12px;color:#64748B">Page ${page} of ${totalPages} &nbsp;·&nbsp; ${total.toLocaleString()} total</span>
      ${page < totalPages ? `<a href="/admin/readings?page=${page+1}&consumer=${consumer}" class="page-btn">Next →</a>` : ''}
    </div>
  </div>
</div>`);
}
 
// ── BILLS PAGE HTML ───────────────────────────────────────────────────────────
function billsPage(bills) {
  const totalAmount = bills.reduce((s,b)=>s+b.billAmount,0);
  const unpaid      = bills.filter(b=>!b.isPaid);
  return layout('Bills', 'bills', `
<div class="page">
  <div class="page-title">All Bills</div>
  <div class="page-sub">${bills.length} bills · ₹ ${totalAmount.toFixed(2)} total · ${unpaid.length} unpaid</div>
 
  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-bar" style="background:#1A4FBD"></div><div class="kpi-label">Total Bills</div><div class="kpi-val">${bills.length}</div></div>
    <div class="kpi"><div class="kpi-bar" style="background:#166534"></div><div class="kpi-label">Total Amount</div><div class="kpi-val" style="font-size:22px">₹${totalAmount.toFixed(0)}</div></div>
    <div class="kpi"><div class="kpi-bar" style="background:#991B1B"></div><div class="kpi-label">Unpaid</div><div class="kpi-val">${unpaid.length}</div><div class="kpi-sub">₹ ${unpaid.reduce((s,b)=>s+b.billAmount,0).toFixed(0)} pending</div></div>
    <div class="kpi"><div class="kpi-bar" style="background:#166534"></div><div class="kpi-label">Paid</div><div class="kpi-val">${bills.length-unpaid.length}</div></div>
  </div>
 
  <div class="card">
    <div class="card-body">
      <table>
        <thead>
          <tr><th>Consumer No.</th><th>Month</th><th>Opening Read</th><th>Closing Read</th><th>Units</th><th>Energy Charge</th><th>Fixed</th><th>LPSC</th><th>Division Duty</th><th>Total</th><th>Due Date</th><th>Status</th></tr>
        </thead>
        <tbody>
          ${bills.length === 0 ? `<tr><td colspan="12" class="empty">No bills generated yet</td></tr>` :
            bills.map(b => `
            <tr>
              <td><a href="/admin/users/${b.consumerNo}" class="mono">${b.consumerNo}</a></td>
              <td>${b.billMonth}</td>
              <td class="mono">${b.openingRead}</td>
              <td class="mono">${b.closingRead}</td>
              <td class="mono">${b.unitsConsumed} kWh</td>
              <td class="mono">₹ ${b.breakdown?.energyCharge?.toFixed(2)||'—'}</td>
              <td class="mono">₹ ${b.breakdown?.fixedCharge?.toFixed(2)||'—'}</td>
              <td class="mono">₹ ${b.breakdown?.lpsc?.toFixed(2)||'—'}</td>
              <td class="mono">₹ ${b.breakdown?.divisionDuty?.toFixed(2)||'—'}</td>
              <td class="mono" style="font-weight:700;color:#1A4FBD">₹ ${b.billAmount}</td>
              <td style="color:#92400E">${b.dueDate||'—'}</td>
              <td><span class="badge ${b.isPaid?'b-green':'b-red'}">${b.isPaid?'Paid':'Unpaid'}</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>
</div>`);
}
 
function errorPage(msg) {
  return layout('Error', '', `<div class="page"><div class="error-box"><strong>Error:</strong> ${msg}</div></div>`);
}
 
module.exports = router;