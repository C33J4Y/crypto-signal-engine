const config = require('../config');
const { sma } = require('../utils/math');

/**
 * Calculate SMA Ribbon (50 and 100 SMA) with trend alignment and pullback detection.
 * @param {Array} candles - Array of candle objects
 * @param {number} fastPeriod - Fast SMA period (default 50)
 * @param {number} slowPeriod - Slow SMA period (default 100)
 * @returns {{ sma50: number, sma100: number, alignment: string, pullback: boolean, points: number }}
 */
function analyze(
  candles,
  fastPeriod = config.scoring.smaFast,
  slowPeriod = config.scoring.smaSlow
) {
  if (candles.length < slowPeriod) {
    return {
      sma50: null,
      sma100: null,
      alignment: 'insufficient_data',
      pullback: false,
      trendPoints: 0,
      pullbackPoints: 0,
    };
  }

  const closes = candles.map(c => c.close);
  const currentPrice = candles[candles.length - 1].close;
  const currentLow = candles[candles.length - 1].low;
  const currentHigh = candles[candles.length - 1].high;

  const sma50 = sma(closes, fastPeriod);
  const sma100 = sma(closes, slowPeriod);

  // Determine alignment
  let alignment = 'neutral';
  let trendPoints = 0;

  if (sma50 > sma100 && currentPrice > sma50 && currentPrice > sma100) {
    alignment = 'bullish';
    trendPoints = 1.5;
  } else if (sma50 < sma100 && currentPrice < sma50 && currentPrice < sma100) {
    alignment = 'bearish';
    trendPoints = 1.5;
  }

  // Pullback detection: price wicks through 50 SMA while trend holds
  let pullback = false;
  let pullbackPoints = 0;

  if (alignment === 'bullish') {
    // Bullish pullback: price wicked down to touch/through 50 SMA
    // Low touched or went below SMA50, but close still above SMA100
    if (currentLow <= sma50 && currentPrice > sma100) {
      pullback = true;
      pullbackPoints = 0.5;
    }
  } else if (alignment === 'bearish') {
    // Bearish pullback: price wicked up to touch/through 50 SMA
    if (currentHigh >= sma50 && currentPrice < sma100) {
      pullback = true;
      pullbackPoints = 0.5;
    }
  }

  return {
    sma50: Math.round(sma50 * 100) / 100,
    sma100: Math.round(sma100 * 100) / 100,
    alignment,
    pullback,
    trendPoints,
    pullbackPoints,
  };
}

module.exports = { analyze };
