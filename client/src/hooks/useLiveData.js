import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

// How many data points to keep in the waveform charts
const MAX_POINTS = 60;

// Generates a single mock reading for placeholder mode (no ESP connected)
function mockReading() {
  const v  = +(231 + (Math.random() - 0.5) * 1.5).toFixed(1);
  const a  = +(2.5 + (Math.random() - 0.5) * 0.3).toFixed(2);
  const pf = +(0.90 + Math.random() * 0.08).toFixed(2);
  const w  = +(v * a * pf).toFixed(1);
  return {
    voltage: v, current: a, power: w,
    energy: 0, frequency: 50, powerFactor: pf,
    reactivePower: +(w * Math.tan(Math.acos(pf))).toFixed(1),
    source: 'mock', timestamp: new Date().toISOString(),
  };
}

export function useLiveData() {
  const { user, token } = useAuth();

  // ── State ──────────────────────────────────────────────
  const [latest,    setLatest]    = useState(null);   // single latest reading
  const [history,   setHistory]   = useState([]);     // rolling array for charts
  const [source,    setSource]    = useState('mock'); // 'mock' | 'esp' | 'sim'
  const [connected, setConnected] = useState(false);  // WS connected?

  const wsRef      = useRef(null);
  const mockTimer  = useRef(null);

  // ── Push a new reading into rolling history ────────────
  const pushReading = useCallback((reading) => {
    setLatest(reading);
    setSource(reading.source || 'mock');
    setHistory(prev => {
      const next = [...prev, reading];
      return next.length > MAX_POINTS ? next.slice(next.length - MAX_POINTS) : next;
    });
  }, []);

  // ── Start mock interval (used when no real ESP data yet) ──
  const startMock = useCallback(() => {
    if (mockTimer.current) return;
    // pre-fill with some history so charts aren't empty
    const pre = Array.from({ length: 20 }, mockReading);
    setHistory(pre);
    setLatest(pre[pre.length - 1]);
    mockTimer.current = setInterval(() => pushReading(mockReading()), 5000);
  }, [pushReading]);

  const stopMock = useCallback(() => {
    if (mockTimer.current) { clearInterval(mockTimer.current); mockTimer.current = null; }
  }, []);

  // ── On mount: check if real data exists, then connect WS ─
  useEffect(() => {
    if (!user || !token) return;

    // 1. Check if any real ESP reading exists in DB
    fetch('/api/readings/latest', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(({ reading }) => {
        if (reading) {
          // Real data exists — show it and wait for WS
          pushReading(reading);
          setSource(reading.source || 'esp');
        } else {
          // No real data yet — start mock
          startMock();
        }
      })
      .catch(() => startMock());

    // 2. Also fetch last 50 readings for chart history
    fetch('/api/readings/live?limit=50', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(({ readings }) => {
        if (readings && readings.length > 0) {
          stopMock();   // real data → stop mock
          setHistory(readings.slice(-MAX_POINTS));
          setSource(readings[readings.length - 1].source || 'esp');
        }
      })
      .catch(() => {});

    // 3. Open WebSocket
    const wsUrl = `ws://localhost:5000`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: 'SUBSCRIBE', consumerNo: user.consumerNo }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'READING' && msg.data) {
          stopMock();   // ← real ESP data arrived — kill mock immediately
          pushReading(msg.data);
        }
      } catch (_) {}
    };

    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    return () => {
      stopMock();
      ws.close();
    };
  }, [user, token]); // eslint-disable-line

  return { latest, history, source, connected };
}
