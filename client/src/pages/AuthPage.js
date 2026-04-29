import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Auth.css';
 
export default function AuthPage() {
  const [mode,    setMode]    = useState('login');
  const [form,    setForm]    = useState({});
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);
 
  const { login } = useAuth();
  const navigate  = useNavigate();
 
  function handle(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }
 
  async function submit(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const url  = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const res  = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Something went wrong'); return; }
      login(data.token, data.user);
      navigate('/dashboard');
    } catch {
      setError('Server unreachable — is the backend running?');
    } finally {
      setLoading(false);
    }
  }
 
  return (
    <div className="auth-bg">
      <div className="auth-card">
 
        <h1 className="auth-title">Smart Energy Meter</h1>
        <p className="auth-sub">Energy Monitoring System</p>
 
        <div className="auth-tabs">
          <button className={mode==='login'?'active':''} onClick={()=>setMode('login')}>Login</button>
          <button className={mode==='register'?'active':''} onClick={()=>setMode('register')}>Register</button>
        </div>
 
        <form onSubmit={submit} className="auth-form">
          {error && <div className="auth-error">{error}</div>}
 
          {mode === 'register' && (
            <>
              <div className="field-group">
                <label>Full Name</label>
                <input name="name" placeholder="" onChange={handle} required />
              </div>
              <div className="field-group">
                <label>Consumer No.</label>
                <input name="consumerNo" placeholder="" onChange={handle} required />
              </div>
              <div className="field-group">
                <label>Meter No.</label>
                <input name="meterNo" placeholder="" onChange={handle} required />
              </div>
              <div className="field-group">
                <label>Phone</label>
                <input name="phone" placeholder="" onChange={handle} />
              </div>
              <div className="field-group">
                <label>Address</label>
                <input name="address" placeholder="" onChange={handle} />
              </div>
            </>
          )}
 
          <div className="field-group">
            <label>Email</label>
            <input name="email" type="email" placeholder="" onChange={handle} required />
          </div>
          <div className="field-group">
            <label>Password</label>
            <input name="password" type="password" placeholder="" onChange={handle} required />
          </div>
 
          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Login →' : 'Create Account →'}
          </button>
        </form>
      </div>
    </div>
  );
}