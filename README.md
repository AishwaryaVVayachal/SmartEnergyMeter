# SmartEnergy Meter — Full Stack Project

## Stack
- **Frontend**: React + Chart.js + React Router
- **Backend**: Node.js + Express + WebSocket (ws)
- **Database**: MongoDB (local or Atlas free tier)
- **Hardware**: ESP32 + PZEM-004T sensor

---

## Quick Start

### 1. MongoDB
**Option A — Local:**
```
Install MongoDB Community: https://www.mongodb.com/try/download/community
Start: mongod
```
**Option B — Atlas (free, cloud):**
- Create account at mongodb.com/atlas
- Create free cluster → get connection string
- Paste into `server/.env` as MONGO_URI

---

### 2. Backend
```bash
cd server
npm install
# Edit .env — set MONGO_URI, JWT_SECRET, ESP_SECRET
npm run dev        # runs with nodemon (auto-restart)
```
Server starts at http://localhost:5000

---

### 3. Frontend
```bash
cd client
npm install
npm start          # opens http://localhost:3000
```

---

### 4. Register a User
- Open http://localhost:3000
- Click Register
- Fill in: Name, Consumer No, Meter No, Address etc.
- Login → dashboard shows with mock data

---

### 5. ESP32 Setup
1. Open `esp32/SmartEnergyMeter.ino` in Arduino IDE
2. Install libraries: PZEM004Tv30, ArduinoJson
3. Edit the CONFIG section:
   - WIFI_SSID / WIFI_PASSWORD
   - SERVER_URL = your laptop's local IP + :5000/api/readings
   - ESP_TOKEN = same as ESP_SECRET in server/.env
   - CONSUMER_NO = the consumer number you registered with
4. Upload to ESP32
5. Open Serial Monitor — you'll see readings being sent
6. Dashboard switches from mock to live automatically ✓

---

## API Reference

### Auth
```
POST /api/auth/register   { email, password, name, consumerNo, meterNo, ... }
POST /api/auth/login      { email, password }
GET  /api/auth/me         (Bearer token required)
```

### Readings (browser — needs JWT)
```
GET  /api/readings/latest
GET  /api/readings/live?limit=50
GET  /api/readings/daily?date=YYYY-MM-DD
GET  /api/readings/monthly-summary
```

### Readings (ESP32 — needs x-esp-token header)
```
POST /api/readings        { consumerNo, voltage, current, power, energy, frequency, powerFactor }
```

### Bills
```
GET  /api/bills
GET  /api/bills/current
POST /api/bills/generate  { month: 'YYYY-MM' }
GET  /api/bills/download/:month
```

### WebSocket
Connect to ws://localhost:5000
Send: `{ "type": "SUBSCRIBE", "consumerNo": "170213894059" }`
Receive: `{ "type": "READING", "data": { voltage, current, ... } }` when ESP posts

---

## Mock → Live Transition
- On login, if NO readings exist in DB → dashboard shows simulated data with yellow banner
- As soon as ESP32 starts posting → banner disappears, all values update to real sensor data
- No code changes needed — it's automatic

---

## Tariff Calculation (MSEDCL LT Residential)
- 0–100 units:   ₹3.25/unit
- 101–300 units: ₹5.45/unit
- >300 units:    ₹7.25/unit
- Fixed charge:  ₹40/month
- LPSC:          1% of energy charge
- Division Duty: 6% of energy charge
