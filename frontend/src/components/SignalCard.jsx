import ConfluenceMeter from './ConfluenceMeter';
import IndicatorBadge from './IndicatorBadge';

function SignalCard({ signal }) {
  const isLong = signal.direction === 'LONG';
  const indicators = signal.indicators || {};

  return (
    <div className={`card signal-card ${isLong ? 'long' : 'short'}`}>
      <div className="signal-header">
        <span className="signal-symbol">{signal.symbol.replace('USDT', '')}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{signal.interval}</span>
          <span className={`signal-direction ${isLong ? 'long' : 'short'}`}>
            {signal.direction}
          </span>
        </div>
      </div>

      <ConfluenceMeter score={signal.confluence_score || signal.confluenceScore} grade={signal.grade} />

      <div className="signal-levels">
        <div className="level-item">
          <span className="level-label">Entry</span>
          <span className="level-value entry">${signal.entry.toLocaleString()}</span>
        </div>
        <div className="level-item">
          <span className="level-label">Stop Loss</span>
          <span className="level-value sl">${(signal.stop_loss || signal.stopLoss).toLocaleString()}</span>
        </div>
        <div className="level-item">
          <span className="level-label">TP1</span>
          <span className="level-value tp">${signal.tp1.toLocaleString()}</span>
        </div>
        <div className="level-item">
          <span className="level-label">TP2</span>
          <span className="level-value tp">${signal.tp2.toLocaleString()}</span>
        </div>
        <div className="level-item">
          <span className="level-label">TP3</span>
          <span className="level-value tp">${signal.tp3.toLocaleString()}</span>
        </div>
        <div className="level-item">
          <span className="level-label">R:R</span>
          <span className="level-value" style={{ color: 'var(--accent-purple)' }}>
            {signal.risk_reward || signal.riskReward}
          </span>
        </div>
      </div>

      <div className="indicator-badges">
        <IndicatorBadge label="RSI" active={indicators.rsi?.points > 0} />
        <IndicatorBadge label="Divergence" active={indicators.rsiDivergence?.points > 0} />
        <IndicatorBadge label="FVG" active={indicators.fvg?.points > 0} />
        <IndicatorBadge label="POC" active={indicators.volumeProfilePOC?.points > 0} />
        <IndicatorBadge label="Volume" active={indicators.volumeSpike?.points > 0} />
        <IndicatorBadge label="SMA" active={indicators.smaRibbon?.points > 0} />
      </div>

      {signal.notes && (
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>{signal.notes}</p>
      )}

      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
        {new Date(signal.timestamp || signal.created_at).toLocaleString()}
      </div>
    </div>
  );
}

export default SignalCard;
