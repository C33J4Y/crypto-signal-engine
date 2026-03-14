/**
 * Divergence Hunter — trades exclusively on RSI divergence setups.
 * RSI divergence is the required gate. Other indicators confirm quality.
 * Regime filter OFF because divergence is inherently countertrend.
 */

module.exports = {
  name: 'divergence-hunter',
  label: 'Divergence Hunter',
  description: 'RSI divergence as required gate, confirmations from FVG/volume/structure',
  indicators: ['rsi', 'fvg', 'volumeProfile', 'volume'],
  useRegimeFilter: false,

  tradeParams: {
    riskPct: 1.0,
    tp1RR: 2.0,
    tp2RR: 3.0,
    maxBars: 48,
    threshold: 5.5,
  },

  evaluate(candle, indicators) {
    const { rsi: r, fvg: f, volumeProfile: vp, volume: vol } = indicators;

    // Hard gate: must have RSI divergence
    if (!r.divergence.detected) return { direction: null, points: 0, fired: [] };

    const direction = r.divergence.type === 'bullish' ? 'LONG' : 'SHORT';
    const fvgDir = direction === 'LONG' ? 'bullish' : 'bearish';

    let points = 0;
    const fired = [];

    // Divergence detected (gate passed)
    points += 4.0; fired.push('RSI-Div');

    // RSI in extreme zone bonus
    if (direction === 'LONG' && r.condition === 'oversold') { points += 1.5; fired.push('RSI-OS'); }
    if (direction === 'SHORT' && r.condition === 'overbought') { points += 1.5; fired.push('RSI-OB'); }

    // FVG confirmation
    if (f.active && f.direction === fvgDir) { points += 2.0; fired.push('FVG'); }

    // Volume spike
    if (vol.spike) { points += 1.5; fired.push('Vol'); }

    // POC proximity
    if (vp.points > 0) { points += 1.0; fired.push('POC'); }

    return { direction, points: Math.round(points * 10) / 10, fired };
  },
};
