/**
 * Conservative Confluence — same indicators as base but requires overwhelming agreement.
 * High threshold (8.0), fewer trades, higher quality.
 */

module.exports = {
  name: 'conservative-confluence',
  label: 'Conservative Confluence',
  description: 'Base scoring with threshold 8.0 — only trades when 4+ indicators agree',
  indicators: ['rsi', 'fvg', 'volumeProfile', 'volume', 'smaRibbon'],
  useRegimeFilter: true,

  tradeParams: {
    tp1RR: 2.0,
    tp2RR: 3.0,
    riskPct: 1.0,
    maxBars: 48,
    threshold: 8.0,
  },

  evaluate(candle, indicators) {
    const { rsi: r, fvg: f, volumeProfile: vp, volume: vol, smaRibbon: sma } = indicators;
    const long = scoreLong(r, f, vp, vol, sma);
    const short = scoreShort(r, f, vp, vol, sma);
    return long.points >= short.points ? long : short;
  },
};

function scoreLong(r, f, vp, vol, sma) {
  let points = 0;
  const fired = [];
  if (r.condition === 'oversold') { points += 1.5; fired.push('RSI-OS'); }
  if (r.divergence.detected && r.divergence.type === 'bullish') { points += 2.0; fired.push('RSI-Div'); }
  if (f.active && f.direction === 'bullish') { points += 2.0; fired.push('FVG'); }
  if (vp.points > 0) { points += 1.5; fired.push('POC'); }
  if (vol.spike) { points += 1.0; fired.push('Vol'); }
  if (sma.alignment === 'bullish') {
    points += 1.5; fired.push('SMA');
    if (sma.pullback) { points += 0.5; fired.push('SMA-PB'); }
  }
  return { direction: 'LONG', points: Math.round(points * 10) / 10, fired };
}

function scoreShort(r, f, vp, vol, sma) {
  let points = 0;
  const fired = [];
  if (r.condition === 'overbought') { points += 1.5; fired.push('RSI-OB'); }
  if (r.divergence.detected && r.divergence.type === 'bearish') { points += 2.0; fired.push('RSI-Div'); }
  if (f.active && f.direction === 'bearish') { points += 2.0; fired.push('FVG'); }
  if (vp.points > 0) { points += 1.5; fired.push('POC'); }
  if (vol.spike) { points += 1.0; fired.push('Vol'); }
  if (sma.alignment === 'bearish') {
    points += 1.5; fired.push('SMA');
    if (sma.pullback) { points += 0.5; fired.push('SMA-PB'); }
  }
  return { direction: 'SHORT', points: Math.round(points * 10) / 10, fired };
}
