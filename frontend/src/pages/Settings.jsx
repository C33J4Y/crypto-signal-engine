import { useState, useEffect } from 'react';

function Settings() {
  const [webhooks, setWebhooks] = useState([]);
  const [form, setForm] = useState({ name: '', url: '', platform: 'discord', minGrade: 'A+' });
  const [health, setHealth] = useState(null);

  useEffect(() => {
    fetch('/api/config/webhooks')
      .then(r => r.json())
      .then(data => setWebhooks(data.webhooks || []))
      .catch(console.error);

    fetch('/api/health')
      .then(r => r.json())
      .then(setHealth)
      .catch(console.error);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await fetch('/api/config/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setForm({ name: '', url: '', platform: 'discord', minGrade: 'A+' });
      // Refresh
      const res = await fetch('/api/config/webhooks');
      const data = await res.json();
      setWebhooks(data.webhooks || []);
    } catch (err) {
      console.error('Failed to save webhook:', err);
    }
  };

  const triggerPoll = async () => {
    try {
      const res = await fetch('/api/poll', { method: 'POST' });
      const data = await res.json();
      alert(`Poll complete: ${data.poll?.totalCandles || 0} candles, ${data.signalCheck?.newSignals || 0} new signals`);
    } catch (err) {
      alert('Poll failed: ' + err.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Settings</h2>
        <div className="subtitle">Webhook configuration and system controls</div>
      </div>

      {/* System Status */}
      {health && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, marginBottom: 16 }}>System Status</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, fontSize: 13 }}>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Uptime: </span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {Math.floor(health.uptime / 3600)}h {Math.floor((health.uptime % 3600) / 60)}m
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Poll Count: </span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{health.pollCount}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Active Signals: </span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{health.activeSignals}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Symbols: </span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{health.config?.symbols?.join(', ')}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Threshold: </span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{health.config?.confluenceThreshold}/10</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Poll Interval: </span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{health.config?.pollIntervalSeconds}s</span>
            </div>
          </div>
          <button className="btn btn-secondary" onClick={triggerPoll} style={{ marginTop: 16 }}>
            Trigger Manual Poll
          </button>
        </div>
      )}

      {/* Add Webhook */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, marginBottom: 16 }}>Add Webhook</h3>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label>Name</label>
              <input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="My Discord"
                required
              />
            </div>
            <div className="form-group">
              <label>Platform</label>
              <select value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })}>
                <option value="discord">Discord</option>
                <option value="telegram">Telegram</option>
                <option value="custom">Custom</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Webhook URL</label>
            <input
              value={form.url}
              onChange={e => setForm({ ...form, url: e.target.value })}
              placeholder="https://discord.com/api/webhooks/..."
              required
            />
          </div>
          <div className="form-group">
            <label>Min Grade</label>
            <select value={form.minGrade} onChange={e => setForm({ ...form, minGrade: e.target.value })}>
              <option value="A+">A+ Only</option>
              <option value="B">B and Above</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary">Save Webhook</button>
        </form>
      </div>

      {/* Existing Webhooks */}
      {webhooks.length > 0 && (
        <div className="card">
          <h3 style={{ fontSize: 14, marginBottom: 16 }}>Configured Webhooks</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Platform</th>
                <th>Min Grade</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {webhooks.map(wh => (
                <tr key={wh.id}>
                  <td>{wh.name}</td>
                  <td>{wh.platform}</td>
                  <td>{wh.min_grade}</td>
                  <td>
                    <span className={`status-badge ${wh.enabled ? 'active' : 'expired'}`}>
                      {wh.enabled ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default Settings;
