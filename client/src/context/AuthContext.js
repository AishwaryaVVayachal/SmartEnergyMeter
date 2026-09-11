import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [token,   setToken]   = useState(() => localStorage.getItem('sem_token') || null);
  const [loading, setLoading] = useState(true);

  // On mount, verify stored token and fetch profile
  useEffect(() => {
    if (!token) { setLoading(false); return; }
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d.user) setUser(d.user); else logout(); })
      .catch(logout)
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line

  function login(token, user) {
    localStorage.setItem('sem_token', token);
    setToken(token);
    setUser(user);
  }

  function logout() {
    localStorage.removeItem('sem_token');
    setToken(null);
    setUser(null);
  }

  return (
    <AuthCtx.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
