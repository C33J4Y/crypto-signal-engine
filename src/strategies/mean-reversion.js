/**
 * Mean Reversion — trades RSI extremes at volume profile boundaries.
 * Ignores SMA trend. Targets larger moves from exhaustion reversals.
 */

module.exports = {
  name: 'mean-reversion',
  label: 'Mean Reversion',
  description: 'RSI extremes + volume profile value area boundaries for reversal trades',
  indicators: ['rsi', 'fvg', 'volumeProfile', 'volume'],
  useRegimeFilter: false,

  tradeParams: {
    tp1RR: 2.0,
    tp2RR: 3.5,
    riskPct: 1.2,
    maxBars: 64,
    threshold: 5.0,
  },

  evaluate(candle, indicators) {
    const { rsi: r, fvg: f, volumeProfile: vp, volume: vol } = indicators;
    const price = candle.close;

    // Long: RSI oversold near value area low
    const longPts = scoreLong(r, f, vp, vol, price);
    const shortPts = scoreShort(r, f, vp, vol, price);
    return longPts.points >= shortPts.points ? longPts : shortPts;
  },
};

function scoreLong(r, f, vp, vol, price) {
  let points = 0;
  const fired = [];

  // RSI extreme is the primary driver
  if (r.condition === 'oversold') { points += 2.0; fired.push('RSI-OS'); }
  if (r.divergence.detected && r.divergence.type === 'bullish') { points += 3.0; fired.push('RSI-Div'); }

  // Near POC or value area low
  if (vp.points > 0) { points += 2.0; fired.push('POC'); }
  if (vp.val && price <= vp.val * 1.002) { points += 1.0; fired.push('VAL'); }

  // Volume spike confirms exhaustion
  if (vol.spike) { points += 1.5; fired.push('Vol'); }

  // FVG as structure confirmation
  if (f.active && f.direction === 'bullish') { points += 1.5; fired.push('FVG'); }

  return { direction: 'LONG', points: Math.round(points * 10) / 10, fired };
}

function scoreShort(r, f, vp, vol, price) {
  let points = 0;
  const fired = [];

  if (r.condition === 'overbought') { points += 2.0; fired.push('RSI-OB'); }
  if (r.divergence.detected && r.divergence.type === 'bearish') { points += 3.0; fired.push('RSI-Div'); }

  if (vp.points > 0) { points += 2.0; fired.push('POC'); }
  if (vp.vah && price >= vp.vah * 0.998) { points += 1.0; fired.push('VAH'); }

  if (vol.spike) { points += 1.5; fired.push('Vol'); }

  if (f.active && f.direction === 'bearish') { points += 1.5; fired.push('FVG'); }

  return { direction: 'SHORT', points: Math.round(points * 10) / 10, fired };
}
