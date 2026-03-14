/**
 * Regime Adaptive — changes scoring logic based on detected market regime.
 * Trending: acts like trend-following (SMA gate, pullback focus).
 * Ranging: acts like mean-reversion (RSI extreme gate, structure focus).
 */

module.exports = {
  name: 'regime-adaptive',
  label: 'Regime Adaptive',
  description: 'Switches between trend-following and mean-reversion based on regime',
  indicators: ['rsi', 'fvg', 'volumeProfile', 'volume', 'smaRibbon'],
  useRegimeFilter: false, // Handles regime logic internally

  // Per-symbol optimized params (5-year backtest sweep)
  symbolParams: {
    BTCUSDT: { riskPct: 0.3, tp1RR: 1.2, tp2RR: 2.0, maxBars: 96 },
    ETHUSDT: { riskPct: 0.75, tp1RR: 2.0, tp2RR: 2.5, maxBars: 96 },
    SOLUSDT: { riskPct: 1.0, tp1RR: 2.0, tp2RR: 2.5, maxBars: 96 },
  },

  tradeParams: {
    riskPct: 0.75,
    tp1RR: 1.5,
    tp2RR: 2.5,
    maxBars: 96,
    // threshold removed — uses config.scoring.confluenceThreshold (4.5)
  },

  evaluate(candle, indicators, opts) {
    const regime = opts.currentRegime;

    if (!regime || regime.regime === 'unknown') {
      // No regime data — fall back to base-like scoring
      return fallbackScore(indicators);
    }

    if (regime.regime === 'ranging') {
      return rangingMode(candle, indicators);
    }

    // Trending bull or bear
    return trendingMode(candle, indicators, regime.regime);
  },
};

function trendingMode(candle, indicators, regime) {
  const { rsi: r, fvg: f, volumeProfile: vp, volume: vol, smaRibbon: sma } = indicators;

  // Score with-trend setup
  const withTrend = scoreTrend(regime === 'trending_bull' ? 'LONG' : 'SHORT', r, f, vp, vol, sma);

  // Also score counter-trend (e.g. short in bull trend on RSI overbought + divergence)
  const counterDir = regime === 'trending_bull' ? 'SHORT' : 'LONG';
  const counter = scoreCounterTrend(counterDir, r, f, vp, vol);

  return withTrend.points >= counter.points ? withTrend : counter;
}

function scoreTrend(direction, r, f, vp, vol, sma) {
  const fvgDir = direction === 'LONG' ? 'bullish' : 'bearish';
  let points = 0;
  const fired = [];

  // SMA alignment with trend
  if ((direction === 'LONG' && sma.alignment === 'bullish') ||
      (direction === 'SHORT' && sma.alignment === 'bearish')) {
    points += 1.5; fired.push('SMA');
    if (sma.pullback) { points += 1.5; fired.push('SMA-PB'); }
  }

  // RSI confirmation (near levels get partial)
  if (direction === 'LONG' && (r.condition === 'oversold' || r.condition === 'near_oversold')) {
    points += r.points; fired.push('RSI-OS');
  }
  if (direction === 'SHORT' && (r.condition === 'overbought' || r.condition === 'near_overbought')) {
    points += r.points; fired.push('RSI-OB');
  }

  if (r.divergence.detected) {
    const matchesDir = (direction === 'LONG' && r.divergence.type === 'bullish') ||
                       (direction === 'SHORT' && r.divergence.type === 'bearish');
    if (matchesDir) { points += 2.0; fired.push('RSI-Div'); }
  }

  if (f.active && f.direction === fvgDir) { points += 2.0; fired.push('FVG'); }
  if (vol.points > 0) { points += vol.points; fired.push('Vol'); }
  if (vp.points > 0) { points += vp.points; fired.push('POC'); }

  return { direction, points: Math.round(points * 10) / 10, fired };
}

function scoreCounterTrend(direction, r, f, vp, vol) {
  let points = 0;
  const fired = [];

  // Counter-trend requires RSI extreme + divergence or FVG
  if (direction === 'LONG' && (r.condition === 'oversold')) {
    points += 1.5; fired.push('RSI-OS');
  }
  if (direction === 'SHORT' && (r.condition === 'overbought')) {
    points += 1.5; fired.push('RSI-OB');
  }

  if (r.divergence.detected) {
    const matchesDir = (direction === 'LONG' && r.divergence.type === 'bullish') ||
                       (direction === 'SHORT' && r.divergence.type === 'bearish');
    if (matchesDir) { points += 2.0; fired.push('RSI-Div'); }
  }

  const fvgDir = direction === 'LONG' ? 'bullish' : 'bearish';
  if (f.active && f.direction === fvgDir) { points += 2.0; fired.push('FVG'); }
  if (vp.points > 0) { points += vp.points; fired.push('POC'); }
  if (vol.points > 0) { points += vol.points; fired.push('Vol'); }

  return { direction, points: Math.round(points * 10) / 10, fired };
}

function rangingMode(candle, indicators) {
  const { rsi: r, fvg: f, volumeProfile: vp, volume: vol } = indicators;
  const price = candle.close;

  const long = scoreRange('LONG', r, f, vp, vol, price);
  const short = scoreRange('SHORT', r, f, vp, vol, price);
  return long.points >= short.points ? long : short;
}

function scoreRange(direction, r, f, vp, vol, price) {
  let points = 0;
  const fired = [];

  if (direction === 'LONG') {
    if (r.condition === 'oversold') { points += 2.0; fired.push('RSI-OS'); }
    else if (r.condition === 'near_oversold') { points += 1.0; fired.push('RSI-OS'); }
    if (r.divergence.detected && r.divergence.type === 'bullish') { points += 2.0; fired.push('RSI-Div'); }
    if (vp.val && price <= vp.val * 1.005) { points += 1.5; fired.push('VAL'); }
    if (f.active && f.direction === 'bullish') { points += 2.0; fired.push('FVG'); }
  } else {
    if (r.condition === 'overbought') { points += 2.0; fired.push('RSI-OB'); }
    else if (r.condition === 'near_overbought') { points += 1.0; fired.push('RSI-OB'); }
    if (r.divergence.detected && r.divergence.type === 'bearish') { points += 2.0; fired.push('RSI-Div'); }
    if (vp.vah && price >= vp.vah * 0.995) { points += 1.5; fired.push('VAH'); }
    if (f.active && f.direction === 'bearish') { points += 2.0; fired.push('FVG'); }
  }

  if (vp.points > 0) { points += vp.points; fired.push('POC'); }
  if (vol.points > 0) { points += vol.points; fired.push('Vol'); }

  return { direction, points: Math.round(points * 10) / 10, fired };
}

function fallbackScore(indicators) {
  const { rsi: r, fvg: f, volumeProfile: vp, volume: vol, smaRibbon: sma } = indicators;

  // Score both directions and return the better one
  const long = scoreFallback('LONG', r, f, vp, vol, sma);
  const short = scoreFallback('SHORT', r, f, vp, vol, sma);
  return long.points >= short.points ? long : short;
}

function scoreFallback(direction, r, f, vp, vol, sma) {
  let points = 0;
  const fired = [];

  // SMA alignment
  if ((direction === 'LONG' && sma.alignment === 'bullish') ||
      (direction === 'SHORT' && sma.alignment === 'bearish')) {
    points += 1.5; fired.push('SMA');
    if (sma.pullback) { points += 0.5; fired.push('SMA-PB'); }
  }

  // RSI
  if (direction === 'LONG' && (r.condition === 'oversold' || r.condition === 'near_oversold')) {
    points += r.points; fired.push('RSI-OS');
  }
  if (direction === 'SHORT' && (r.condition === 'overbought' || r.condition === 'near_overbought')) {
    points += r.points; fired.push('RSI-OB');
  }

  // Divergence
  if (r.divergence.detected) {
    const matchesDir = (direction === 'LONG' && r.divergence.type === 'bullish') ||
                       (direction === 'SHORT' && r.divergence.type === 'bearish');
    if (matchesDir) { points += 2.0; fired.push('RSI-Div'); }
  }

  // FVG
  const fvgDir = direction === 'LONG' ? 'bullish' : 'bearish';
  if (f.active && f.direction === fvgDir) { points += 2.0; fired.push('FVG'); }

  if (vp.points > 0) { points += vp.points; fired.push('POC'); }
  if (vol.points > 0) { points += vol.points; fired.push('Vol'); }

  return { direction, points: Math.round(points * 10) / 10, fired };
}
