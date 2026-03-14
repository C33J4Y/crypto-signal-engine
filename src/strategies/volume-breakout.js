/**
 * Volume Breakout — volume spike as the primary signal.
 * Looks for breakout confirmation from SMA and price structure.
 * Breakouts resolve quickly or fail — short maxBars.
 */

module.exports = {
  name: 'volume-breakout',
  label: 'Volume Breakout',
  description: 'Volume spike as gate, confirmed by SMA trend + price structure',
  indicators: ['fvg', 'volumeProfile', 'volume', 'smaRibbon'],
  useRegimeFilter: true,

  tradeParams: {
    riskPct: 0.8,
    tp1RR: 1.5,
    tp2RR: 0,
    maxBars: 32,
    threshold: 5.0,
  },

  evaluate(candle, indicators) {
    const { fvg: f, volumeProfile: vp, volume: vol, smaRibbon: sma } = indicators;

    // Hard gate: must have volume spike
    if (!vol.spike) return { direction: null, points: 0, fired: [] };

    // Determine direction from SMA + price position
    let direction = null;
    if (sma.alignment === 'bullish') direction = 'LONG';
    else if (sma.alignment === 'bearish') direction = 'SHORT';
    else {
      // No clear trend during spike — skip
      return { direction: null, points: 0, fired: [] };
    }

    const fvgDir = direction === 'LONG' ? 'bullish' : 'bearish';

    let points = 0;
    const fired = [];

    // Volume spike (gate passed)
    points += 2.5; fired.push('Vol');

    // Extra points for very high volume ratio
    if (vol.ratio >= 3.0) { points += 1.0; fired.push('Vol-3x'); }

    // SMA alignment
    points += 2.0; fired.push('SMA');

    // Price above/below both SMAs confirms breakout
    if (sma.pullback === false) { points += 1.0; fired.push('SMA-Break'); }

    // FVG
    if (f.active && f.direction === fvgDir) { points += 1.5; fired.push('FVG'); }

    // POC
    if (vp.points > 0) { points += 1.0; fired.push('POC'); }

    return { direction, points: Math.round(points * 10) / 10, fired };
  },
};
