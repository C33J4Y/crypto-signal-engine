import { useState, useEffect } from 'react';
import AssetSelector from '../components/AssetSelector';

function History() {
  const [signals, setSignals] = useState([]);
  const [selectedAsset, setSelectedAsset] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/signals?limit=100')
      .then(r => {
        if (!r.ok) throw new Error(`API error: ${r.status}`);
        return r.json();
      })
      .then(data => { setSignals(data.signals || []); setError(null); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading history</div>;

  const filtered = selectedAsset === 'ALL'
    ? signals
    : signals.filter(s => s.symbol === selectedAsset);

  return (
    <div>
      <div className="page-header">
        <h2>Signal History</h2>
        <div className="subtitle">{signals.length} signals generated</div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--accent-red)', marginBottom: 16, padding: 12, fontSize: 13 }}>
          <span style={{ color: 'var(--accent-red)' }}>Backend unavailable:</span>{' '}
          <span style={{ color: 'var(--text-secondary)' }}>{error}</span>
        </div>
      )}

      <AssetSelector selected={selectedAsset} onSelect={setSelectedAsset} />

      {filtered.length > 0 ? (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>TF</th>
                <th>Direction</th>
                <th>Score</th>
                <th>Entry</th>
                <th>SL</th>
                <th>TP2</th>
                <th>R:R</th>
                <th>Status</th>
                <th>P&L</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(signal => (
                <tr key={signal.id}>
                  <td style={{ fontSize: 10 }}>
                    {new Date(signal.timestamp || signal.created_at).toLocaleString()}
                  </td>
                  <td>{signal.symbol.replace('USDT', '')}</td>
                  <td>{signal.interval}</td>
                  <td>
                    <span className={`signal-direction ${signal.direction.toLowerCase()}`}>
                      {signal.direction}
                    </span>
                  </td>
                  <td style={{ color: 'var(--accent-purple)' }}>
                    {signal.confluence_score}
                  </td>
                  <td>${signal.entry.toLocaleString()}</td>
                  <td style={{ color: 'var(--accent-red)' }}>${signal.stop_loss.toLocaleString()}</td>
                  <td style={{ color: 'var(--accent-green)' }}>${signal.tp2.toLocaleString()}</td>
                  <td>{signal.risk_reward}</td>
                  <td>
                    <span className={`status-badge ${signal.status}`}>{signal.status.replace('_', ' ')}</span>
                  </td>
                  <td style={{
                    color: signal.outcome_pnl > 0 ? 'var(--accent-green)' :
                           signal.outcome_pnl < 0 ? 'var(--accent-red)' : 'var(--text-muted)',
                  }}>
                    {signal.outcome_pnl != null ? `${signal.outcome_pnl.toFixed(2)}%` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <div className="icon">~</div>
          <p>No signals recorded yet</p>
        </div>
      )}
    </div>
  );
}

export default History;
