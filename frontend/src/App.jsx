import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard';
import Charts from './pages/Charts';
import History from './pages/History';
import Performance from './pages/Performance';
import Settings from './pages/Settings';
import ForwardTest from './pages/ForwardTest';

function App() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    const fetchHealth = () => {
      fetch('/api/health')
        .then(r => r.json())
        .then(setHealth)
        .catch(() => setHealth(null));
    };
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <BrowserRouter>
      <div className="app">
        <aside className="sidebar">
          <div className="sidebar-logo">
            <h1>CryptoSignal</h1>
            <div className="subtitle">Confluence Engine</div>
          </div>
          <nav>
            <NavLink to="/" end>Dashboard</NavLink>
            <NavLink to="/charts">Charts</NavLink>
            <NavLink to="/history">Signal History</NavLink>
            <NavLink to="/performance">Performance</NavLink>
            <NavLink to="/forward-test">Forward Test</NavLink>
            <NavLink to="/settings">Settings</NavLink>
          </nav>
          <div className="sidebar-status">
            <span className={`status-dot ${health ? 'online' : 'offline'}`} />
            {health ? `Online | ${health.pollCount} polls` : 'Connecting...'}
          </div>
        </aside>
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/charts" element={<Charts />} />
            <Route path="/history" element={<History />} />
            <Route path="/performance" element={<Performance />} />
            <Route path="/forward-test" element={<ForwardTest />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
