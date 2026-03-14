/**
 * Trend Following — SMA ribbon alignment as hard gate, then pullback + confirmation.
 * Ignores RSI extremes (they're countertrend signals in trending context).
 */

module.exports = {
  name: 'trend-following',
  label: 'Trend Following',
  description: 'SMA-gated: only trades pullbacks in the direction of the trend',
  indicators: ['fvg', 'volumeProfile', 'volume', 'smaRibbon'],
  useRegimeFilter: true,

  tradeParams: {
    riskPct: 0.6,
    tp1RR: 1.2,
    tp2RR: 0,
    maxBars: 24,
    threshold: 5.0,
  },

  evaluate(candle, indicators) {
    const { fvg: f, volumeProfile: vp, volume: vol, smaRibbon: sma } = indicators;

    // Hard gate: SMA must be aligned
    if (sma.alignment === 'bullish') return scoreTrend('LONG', f, vp, vol, sma, 'bullish');
    if (sma.alignment === 'bearish') return scoreTrend('SHORT', f, vp, vol, sma, 'bearish');

    // No trend — no trade
    return { direction: null, points: 0, fired: [] };
  },
};

function scoreTrend(direction, f, vp, vol, sma, fvgDir) {
  let points = 0;
  const fired = [];

  // SMA aligned (gate passed)
  points += 2.0; fired.push('SMA');

  // Pullback to SMA50 is the core setup
  if (sma.pullback) { points += 3.0; fired.push('SMA-PB'); }

  // FVG in trend direction
  if (f.active && f.direction === fvgDir) { points += 2.5; fired.push('FVG'); }

  // Volume confirmation
  if (vol.spike) { points += 2.0; fired.push('Vol'); }

  // POC proximity
  if (vp.points > 0) { points += 1.5; fired.push('POC'); }

  return { direction, points: Math.round(points * 10) / 10, fired };
}
