import { useState, useEffect } from 'react';

const DEFAULT_PERF = {
  total: 0, active: 0, wins: 0, losses: 0, expired: 0,
  winRate: 'N/A', avgPnl: 0, bySymbol: {}, byTimeframe: {},
};

function Performance() {
  const [perf, setPerf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPerf = () => {
    fetch('/api/performance')
      .then(r => {
        if (!r.ok) throw new Error(`API error: ${r.status}`);
        return r.json();
      })
      .then(data => { setPerf(data); setError(null); })
      .catch(err => { setError(err.message); setPerf(DEFAULT_PERF); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchPerf();
    const interval = setInterval(fetchPerf, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div className="loading">Loading performance</div>;

  const data = perf || DEFAULT_PERF;
  const decided = data.wins + data.losses;

  return (
    <div>
      <div className="page-header">
        <h2>Performance</h2>
        <div className="subtitle">Signal accuracy and profitability metrics</div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--accent-red)', marginBottom: 16, padding: 12, fontSize: 13 }}>
          <span style={{ color: 'var(--accent-red)' }}>Backend unavailable:</span>{' '}
          <span style={{ color: 'var(--text-secondary)' }}>{error}</span>
          <button className="btn btn-secondary" onClick={fetchPerf} style={{ marginLeft: 12, padding: '4px 12px', fontSize: 11 }}>
            Retry
          </button>
        </div>
      )}

      {/* Overview Stats */}
      <div className="stats-row">
        <div className="card stat-card">
          <div className="stat-value">{data.total}</div>
          <div className="stat-label">Total Signals</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value" style={{ color: 'var(--accent-cyan)' }}>{data.active}</div>
          <div className="stat-label">Active</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value">{data.wins}</div>
          <div className="stat-label">Wins</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value negative">{data.losses}</div>
          <div className="stat-label">Losses</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value" style={{
            color: data.winRate !== 'N/A' && parseFloat(data.winRate) > 50
              ? 'var(--accent-green)' : 'var(--text-secondary)',
          }}>
            {data.winRate}
          </div>
          <div className="stat-label">Win Rate</div>
        </div>
        <div className="card stat-card">
          <div className={`stat-value ${data.avgPnl >= 0 ? '' : 'negative'}`}>
            {data.avgPnl > 0 ? '+' : ''}{data.avgPnl}%
          </div>
          <div className="stat-label">Avg P&L</div>
        </div>
      </div>

      {/* Win/Loss Visual Bar */}
      {decided > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            <span>Wins: {data.wins}</span>
            <span>Losses: {data.losses}</span>
          </div>
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--bg-primary)' }}>
            <div style={{ width: `${(data.wins / decided) * 100}%`, background: 'var(--accent-green)', transition: 'width 0.5s' }} />
            <div style={{ width: `${(data.losses / decided) * 100}%`, background: 'var(--accent-red)', transition: 'width 0.5s' }} />
          </div>
        </div>
      )}

      {/* By Symbol */}
      {data.bySymbol && Object.keys(data.bySymbol).length > 0 && (
        <>
          <h3 style={{ fontSize: 14, marginBottom: 12, marginTop: 24 }}>By Asset</h3>
          <div className="card" style={{ overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Total</th>
                  <th>Wins</th>
                  <th>Losses</th>
                  <th>Win Rate</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.bySymbol).map(([symbol, s]) => {
                  const d = s.wins + s.losses;
                  const wr = d > 0 ? `${((s.wins / d) * 100).toFixed(1)}%` : 'N/A';
                  return (
                    <tr key={symbol}>
                      <td>{symbol.replace('USDT', '')}</td>
                      <td>{s.total}</td>
                      <td style={{ color: 'var(--accent-green)' }}>{s.wins}</td>
                      <td style={{ color: 'var(--accent-red)' }}>{s.losses}</td>
                      <td>{wr}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* By Timeframe */}
      {data.byTimeframe && Object.keys(data.byTimeframe).length > 0 && (
        <>
          <h3 style={{ fontSize: 14, marginBottom: 12, marginTop: 24 }}>By Timeframe</h3>
          <div className="card" style={{ overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timeframe</th>
                  <th>Total</th>
                  <th>Wins</th>
                  <th>Losses</th>
                  <th>Win Rate</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.byTimeframe).map(([tf, s]) => {
                  const d = s.wins + s.losses;
                  const wr = d > 0 ? `${((s.wins / d) * 100).toFixed(1)}%` : 'N/A';
                  return (
                    <tr key={tf}>
                      <td>{tf}</td>
                      <td>{s.total}</td>
                      <td style={{ color: 'var(--accent-green)' }}>{s.wins}</td>
                      <td style={{ color: 'var(--accent-red)' }}>{s.losses}</td>
                      <td>{wr}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data.total === 0 && !error && (
        <div className="empty-state" style={{ marginTop: 24 }}>
          <div className="icon">~</div>
          <p>No performance data yet — signals will appear as they are generated and tracked</p>
        </div>
      )}
    </div>
  );
}

export default Performance;
