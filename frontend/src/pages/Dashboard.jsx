import { useState, useEffect } from 'react';
import SignalCard from '../components/SignalCard';
import AssetSelector from '../components/AssetSelector';

function Dashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [signals, setSignals] = useState([]);
  const [selectedAsset, setSelectedAsset] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [dashRes, sigRes] = await Promise.all([
          fetch('/api/dashboard'),
          fetch('/api/signals?status=active&limit=20'),
        ]);
        if (!dashRes.ok) throw new Error(`Dashboard API: ${dashRes.status}`);
        if (!sigRes.ok) throw new Error(`Signals API: ${sigRes.status}`);
        setDashboard(await dashRes.json());
        const sigData = await sigRes.json();
        setSignals(sigData.signals || []);
        setError(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div className="loading">Loading dashboard</div>;

  const filteredSignals = selectedAsset === 'ALL'
    ? signals
    : signals.filter(s => s.symbol === selectedAsset);

  const assets = dashboard ? Object.keys(dashboard) : [];

  return (
    <div>
      <div className="page-header">
        <h2>Live Dashboard</h2>
        <div className="subtitle">Real-time indicator readings across all assets</div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--accent-red)', marginBottom: 16, padding: 12, fontSize: 13 }}>
          <span style={{ color: 'var(--accent-red)' }}>Backend unavailable:</span>{' '}
          <span style={{ color: 'var(--text-secondary)' }}>{error} — Make sure the backend is running on port 3002</span>
        </div>
      )}

      {/* Market Overview */}
      <div className="dashboard-grid">
        {assets.map(symbol => {
          const data = dashboard[symbol]?.['15m'];
          if (!data || data.status === 'no_data') return null;

          return (
            <div className="card stat-card" key={symbol}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
                {symbol.replace('USDT', '')}/USDT
              </div>
              <div className="stat-value">
                ${data.price?.toLocaleString()}
              </div>
              {data.change24h && (
                <div style={{
                  fontSize: 12,
                  color: data.change24h?.startsWith('-') ? 'var(--accent-red)' : 'var(--accent-green)',
                  fontFamily: 'var(--font-mono)',
                  marginTop: 2,
                }}>
                  {data.change24h}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12, fontSize: 11 }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>RSI: </span>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    color: data.rsi <= 35 ? 'var(--accent-green)' :
                           data.rsi >= 65 ? 'var(--accent-red)' : 'var(--text-primary)',
                  }}>
                    {data.rsi}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>SMA: </span>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    color: data.smaAlignment === 'bullish' ? 'var(--accent-green)' :
                           data.smaAlignment === 'bearish' ? 'var(--accent-red)' : 'var(--text-secondary)',
                  }}>
                    {data.smaAlignment}
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Vol: </span>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    color: data.volumeSpike ? 'var(--accent-yellow)' : 'var(--text-primary)',
                  }}>
                    {data.volumeRatio}x
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>FVGs: </span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{data.activeFvgs}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>POC: </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>${data.poc?.toLocaleString()}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>SMA50: </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>${data.sma50?.toLocaleString()}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Active Signals */}
      <div className="page-header" style={{ marginTop: 8 }}>
        <h2>Active Signals</h2>
        <div className="subtitle">A+ setups currently in play</div>
      </div>

      <AssetSelector selected={selectedAsset} onSelect={setSelectedAsset} />

      {filteredSignals.length > 0 ? (
        <div className="card-grid">
          {filteredSignals.map(signal => (
            <SignalCard key={signal.id} signal={signal} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div className="icon">~</div>
          <p>No active signals — waiting for A+ confluence setups</p>
          <p style={{ fontSize: 12, marginTop: 8 }}>The engine is scanning {assets.length} assets on 15m every 60 seconds</p>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
