import { useState, useEffect, useCallback } from 'react';

const SYMBOLS = ['ALL', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const INTERVALS = ['ALL', '15m', '1h'];
const HOUR_OPTIONS = [1, 4, 12, 24, 48, 72];

export default function ForwardTest() {
  const [stats, setStats] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [topScores, setTopScores] = useState([]);
  const [symbol, setSymbol] = useState('ALL');
  const [interval, setInterval_] = useState('ALL');
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams({ hours: String(hours) });
      if (symbol !== 'ALL') params.set('symbol', symbol);
      if (interval !== 'ALL') params.set('interval', interval);

      const [statsRes, timelineRes, topRes] = await Promise.all([
        fetch('/api/forward-test/stats'),
        fetch(`/api/forward-test/timeline?${params}`),
        fetch(`/api/forward-test/scores?minScore=3&limit=50${symbol !== 'ALL' ? `&symbol=${symbol}` : ''}`),
      ]);

      const [statsData, timelineData, topData] = await Promise.all([
        statsRes.json(), timelineRes.json(), topRes.json(),
      ]);

      setStats(statsData.stats);
      setTimeline(timelineData);
      setTopScores(topData.scores);
    } catch (err) {
      console.error('Forward test fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [symbol, interval, hours]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 60s
  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(fetchData, 60000);
    return () => window.clearInterval(id);
  }, [autoRefresh, fetchData]);

  const scoreColor = (score) => {
    if (score >= 4.5) return 'var(--accent-green)';
    if (score >= 3.5) return 'var(--accent-yellow, #ffaa00)';
    if (score >= 2.0) return 'var(--text-secondary)';
    return 'var(--text-muted)';
  };

  const gradeClass = (grade) => {
    if (grade === 'A+') return 'grade-a-plus';
    if (grade === 'B') return 'grade-b';
    return 'grade-c';
  };

  return (
    <div>
      <div className="page-header">
        <h2>Forward Test</h2>
        <div className="subtitle">
          Live scoring tracker — every poll cycle logged
          <label className="ft-auto-refresh">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            Auto-refresh
          </label>
        </div>
      </div>

      {/* Filters */}
      <div className="chart-controls">
        <div className="asset-selector">
          {SYMBOLS.map(s => (
            <button key={s} className={`asset-btn ${s === symbol ? 'active' : ''}`} onClick={() => setSymbol(s)}>
              {s === 'ALL' ? 'All' : s.replace('USDT', '')}
            </button>
          ))}
        </div>
        <div className="asset-selector">
          {INTERVALS.map(tf => (
            <button key={tf} className={`asset-btn ${tf === interval ? 'active' : ''}`} onClick={() => setInterval_(tf)}>
              {tf === 'ALL' ? 'All' : tf}
            </button>
          ))}
        </div>
        <div className="asset-selector">
          {HOUR_OPTIONS.map(h => (
            <button key={h} className={`asset-btn ${h === hours ? 'active' : ''}`} onClick={() => setHours(h)}>
              {h}h
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="chart-loading">Loading forward test data...</div>}

      {/* Stats Summary */}
      {stats && stats.length > 0 && (
        <div className="card ft-stats-card">
          <h3>Scoring Stats (All Time)</h3>
          <div className="ft-stats-grid">
            {stats.map(s => (
              <div key={`${s.symbol}-${s.interval}`} className="ft-stat-item">
                <div className="ft-stat-header">
                  <span className="ft-stat-symbol">{s.symbol.replace('USDT', '')}</span>
                  <span className="ft-stat-tf">{s.interval}</span>
                </div>
                <div className="ft-stat-row">
                  <span>Polls</span><span>{s.total_polls}</span>
                </div>
                <div className="ft-stat-row">
                  <span>Avg Score</span><span style={{ color: scoreColor(s.avg_score) }}>{s.avg_score}</span>
                </div>
                <div className="ft-stat-row">
                  <span>Max Score</span><span style={{ color: scoreColor(s.max_score) }}>{s.max_score}</span>
                </div>
                <div className="ft-stat-row">
                  <span>A+ Setups</span><span className="green">{s.a_plus_count}</span>
                </div>
                <div className="ft-stat-row">
                  <span>B Setups</span><span className="yellow">{s.b_count}</span>
                </div>
                <div className="ft-stat-row">
                  <span>Signals</span><span className="green">{s.signals_generated}</span>
                </div>
                {s.cooldown_rejections > 0 && (
                  <div className="ft-stat-row">
                    <span>Cooldown Rej.</span><span className="red">{s.cooldown_rejections}</span>
                  </div>
                )}
                {s.rr_rejections > 0 && (
                  <div className="ft-stat-row">
                    <span>R:R Rej.</span><span className="red">{s.rr_rejections}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Scores */}
      {topScores.length > 0 && (
        <div className="card ft-top-scores">
          <h3>Recent High Scores (3.0+)</h3>
          <table className="ft-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>TF</th>
                <th>Dir</th>
                <th>Score</th>
                <th>Grade</th>
                <th>Fired</th>
                <th>Regime</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {topScores.map((s, i) => (
                <tr key={i} className={s.signal_generated ? 'ft-signal-row' : ''}>
                  <td className="ft-time">{new Date(s.timestamp).toLocaleTimeString()}</td>
                  <td>{s.symbol.replace('USDT', '')}</td>
                  <td>{s.interval}</td>
                  <td className={s.direction === 'LONG' ? 'green' : 'red'}>{s.direction}</td>
                  <td style={{ color: scoreColor(s.score), fontWeight: 'bold' }}>{s.score}</td>
                  <td><span className={`ft-grade ${gradeClass(s.grade)}`}>{s.grade}</span></td>
                  <td className="ft-fired">{s.fired.join(', ')}</td>
                  <td className="ft-regime">{s.regime}</td>
                  <td>
                    {s.signal_generated ? (
                      <span className="ft-signal-badge">SIGNAL</span>
                    ) : s.rejection_reason ? (
                      <span className="ft-rejection">{s.rejection_reason.replace(/_/g, ' ')}</span>
                    ) : (
                      <span className="ft-qualified">qualified</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Timeline */}
      {timeline && timeline.timeline && (
        <div className="card ft-timeline-card">
          <h3>Poll Timeline ({timeline.cycleCount} cycles, last {hours}h)</h3>
          {timeline.cycleCount === 0 ? (
            <div className="ft-empty">No poll data yet. Start the engine and scoring data will appear here.</div>
          ) : (
            <div className="ft-timeline">
              {timeline.timeline.slice(-50).reverse().map((cycle, i) => {
                const bestScore = Math.max(...cycle.scores.map(s => s.score));
                return (
                  <div key={i} className="ft-cycle">
                    <div className="ft-cycle-time">{new Date(cycle.timestamp).toLocaleTimeString()}</div>
                    <div className="ft-cycle-scores">
                      {cycle.scores
                        .filter(s => s.score > 0)
                        .sort((a, b) => b.score - a.score)
                        .map((s, j) => (
                          <span
                            key={j}
                            className={`ft-score-pill ${s.signalGenerated ? 'signal' : ''}`}
                            style={{ borderColor: scoreColor(s.score) }}
                            title={`${s.fired.join(', ')} | ${s.regime} | ${s.rejectionReason || 'ok'}`}
                          >
                            {s.symbol.replace('USDT', '')}/{s.interval} {s.direction[0]}:{s.score}
                          </span>
                        ))
                      }
                    </div>
                    <div className="ft-cycle-best" style={{ color: scoreColor(bestScore) }}>
                      Best: {bestScore}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!loading && (!stats || stats.length === 0) && (!timeline || timeline.cycleCount === 0) && (
        <div className="card">
          <div className="ft-empty">
            <p>No forward test data yet.</p>
            <p>Restart the backend to begin logging scores. Every 60-second poll cycle will be recorded here.</p>
          </div>
        </div>
      )}
    </div>
  );
}
