/**
 * Quick Scalp — optimized for fast in-and-out trades.
 * Requires volume spike + either RSI extreme or FVG.
 * Very tight risk, low TP, very short maxBars.
 * Designed for high win rate, small gains.
 */

module.exports = {
  name: 'quick-scalp',
  label: 'Quick Scalp',
  description: 'Fast trades: volume spike + RSI/FVG, tight risk, small TP targets',
  indicators: ['rsi', 'fvg', 'volumeProfile', 'volume', 'smaRibbon'],
  useRegimeFilter: true,

  tradeParams: {
    riskPct: 0.4,
    tp1RR: 0.8,
    tp2RR: 0,
    maxBars: 12,
    threshold: 4.0,
  },

  evaluate(candle, indicators) {
    const { rsi: r, fvg: f, volumeProfile: vp, volume: vol, smaRibbon: sma } = indicators;

    // Hard gate: need volume spike
    if (!vol.spike) return { direction: null, points: 0, fired: [] };

    // Need at least one directional signal to know which way
    const long = scoreDir('LONG', r, f, vp, vol, sma);
    const short = scoreDir('SHORT', r, f, vp, vol, sma);
    return long.points >= short.points ? long : short;
  },
};

function scoreDir(direction, r, f, vp, vol, sma) {
  let points = 0;
  const fired = [];

  // Volume spike (gate passed)
  points += 2.0; fired.push('Vol');

  if (direction === 'LONG') {
    if (r.condition === 'oversold') { points += 2.0; fired.push('RSI-OS'); }
    if (f.active && f.direction === 'bullish') { points += 2.0; fired.push('FVG'); }
    if (sma.alignment === 'bullish') { points += 1.0; fired.push('SMA'); }
  } else {
    if (r.condition === 'overbought') { points += 2.0; fired.push('RSI-OB'); }
    if (f.active && f.direction === 'bearish') { points += 2.0; fired.push('FVG'); }
    if (sma.alignment === 'bearish') { points += 1.0; fired.push('SMA'); }
  }

  if (vp.points > 0) { points += 1.5; fired.push('POC'); }

  return { direction, points: Math.round(points * 10) / 10, fired };
}
