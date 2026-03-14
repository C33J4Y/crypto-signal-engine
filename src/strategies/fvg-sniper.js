/**
 * FVG Sniper — only trades FVG retests.
 * FVG active is the required gate. Scores higher when aligned with trend.
 * Very tight maxBars because FVG fills resolve quickly.
 */

module.exports = {
  name: 'fvg-sniper',
  label: 'FVG Sniper',
  description: 'FVG retest as required gate, trend alignment + volume confirmation',
  indicators: ['rsi', 'fvg', 'volumeProfile', 'volume', 'smaRibbon'],
  useRegimeFilter: true,

  tradeParams: {
    riskPct: 0.5,
    tp1RR: 1.5,
    tp2RR: 0,
    maxBars: 16,
    threshold: 5.0,
  },

  evaluate(candle, indicators) {
    const { rsi: r, fvg: f, volumeProfile: vp, volume: vol, smaRibbon: sma } = indicators;

    // Hard gate: must be in an active FVG
    if (!f.active) return { direction: null, points: 0, fired: [] };

    const direction = f.direction === 'bullish' ? 'LONG' : 'SHORT';

    let points = 0;
    const fired = [];

    // FVG active (gate passed)
    points += 3.0; fired.push('FVG');

    // SMA alignment matches FVG direction
    if ((direction === 'LONG' && sma.alignment === 'bullish') ||
        (direction === 'SHORT' && sma.alignment === 'bearish')) {
      points += 2.0; fired.push('SMA');
    }

    // Volume spike
    if (vol.spike) { points += 2.0; fired.push('Vol'); }

    // POC proximity
    if (vp.points > 0) { points += 1.5; fired.push('POC'); }

    // Penalize if RSI opposes the FVG direction
    if (direction === 'LONG' && r.condition === 'overbought') { points -= 1.0; fired.push('RSI-X'); }
    if (direction === 'SHORT' && r.condition === 'oversold') { points -= 1.0; fired.push('RSI-X'); }

    return { direction, points: Math.round(Math.max(0, points) * 10) / 10, fired };
  },
};
