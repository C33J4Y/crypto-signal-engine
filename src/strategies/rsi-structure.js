/**
 * RSI + Structure — combines RSI with price structure (FVG + Volume Profile).
 * Completely ignores SMA trend data.
 * Thesis: structural S/R matters more than trend on shorter timeframes.
 */

module.exports = {
  name: 'rsi-structure',
  label: 'RSI + Structure',
  description: 'RSI + FVG + Volume Profile only — ignores SMA trend entirely',
  indicators: ['rsi', 'fvg', 'volumeProfile', 'volume'],
  useRegimeFilter: false,

  tradeParams: {
    riskPct: 1.0,
    tp1RR: 1.5,
    tp2RR: 2.5,
    maxBars: 48,
    threshold: 6.0,
  },

  evaluate(candle, indicators) {
    const { rsi: r, fvg: f, volumeProfile: vp, volume: vol } = indicators;

    const long = score('LONG', r, f, vp, vol);
    const short = score('SHORT', r, f, vp, vol);
    return long.points >= short.points ? long : short;
  },
};

function score(direction, r, f, vp, vol) {
  let points = 0;
  const fired = [];

  if (direction === 'LONG') {
    if (r.condition === 'oversold') { points += 2.0; fired.push('RSI-OS'); }
    if (r.divergence.detected && r.divergence.type === 'bullish') { points += 2.5; fired.push('RSI-Div'); }
    if (f.active && f.direction === 'bullish') { points += 2.0; fired.push('FVG'); }
  } else {
    if (r.condition === 'overbought') { points += 2.0; fired.push('RSI-OB'); }
    if (r.divergence.detected && r.divergence.type === 'bearish') { points += 2.5; fired.push('RSI-Div'); }
    if (f.active && f.direction === 'bearish') { points += 2.0; fired.push('FVG'); }
  }

  // Shared: structure indicators
  if (vp.points > 0) { points += 2.0; fired.push('POC'); }
  if (vol.spike) { points += 1.5; fired.push('Vol'); }

  return { direction, points: Math.round(points * 10) / 10, fired };
}
