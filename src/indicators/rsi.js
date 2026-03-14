const config = require('../config');

/**
 * Calculate RSI using Wilder smoothing.
 * @param {Array} candles - Array of candle objects with `close` property
 * @param {number} period - RSI period (default 14)
 * @returns {{ values: number[], current: number }}
 */
function calculateRSI(candles, period = config.scoring.rsiPeriod) {
  if (candles.length < period + 1) {
    return { values: [], current: null };
  }

  const closes = candles.map(c => c.close);
  const gains = [];
  const losses = [];

  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  // Seed with SMA of first `period` values
  let avgGain = gains.slice(0, period).reduce((s, v) => s + v, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((s, v) => s + v, 0) / period;

  const rsiValues = [];

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsiValues.push(100 - 100 / (1 + rs));

  // Wilder smoothing for remaining values
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiValues.push(100 - 100 / (1 + rs));
  }

  return {
    values: rsiValues,
    current: rsiValues[rsiValues.length - 1],
  };
}

/**
 * Find swing lows in a price series.
 * A swing low at index i requires price[i] < price[i-n..i-1] and price[i] < price[i+1..i+n]
 */
function findSwingLows(values, strength = config.scoring.rsiDivergenceSwingStrength) {
  const swings = [];
  for (let i = strength; i < values.length - strength; i++) {
    let isSwing = true;
    for (let j = 1; j <= strength; j++) {
      if (values[i] >= values[i - j] || values[i] >= values[i + j]) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) swings.push({ index: i, value: values[i] });
  }
  return swings;
}

/**
 * Find swing highs in a price series.
 */
function findSwingHighs(values, strength = config.scoring.rsiDivergenceSwingStrength) {
  const swings = [];
  for (let i = strength; i < values.length - strength; i++) {
    let isSwing = true;
    for (let j = 1; j <= strength; j++) {
      if (values[i] <= values[i - j] || values[i] <= values[i + j]) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) swings.push({ index: i, value: values[i] });
  }
  return swings;
}

/**
 * Detect RSI divergence.
 * @param {Array} candles - Candle array
 * @param {number[]} rsiValues - RSI values aligned to end of candles array
 * @param {number} lookback - How far back to look for divergence (default 50)
 * @returns {{ detected: boolean, type: 'bullish'|'bearish'|null }}
 */
function detectDivergence(candles, rsiValues, lookback = config.scoring.rsiDivergenceLookback) {
  if (rsiValues.length < lookback) {
    return { detected: false, type: null };
  }

  // Align RSI values with candle close prices
  // rsiValues[0] corresponds to candle at index (candles.length - rsiValues.length)
  const offset = candles.length - rsiValues.length;
  const startIdx = Math.max(0, rsiValues.length - lookback);

  const recentRSI = rsiValues.slice(startIdx);
  const recentCloses = candles.slice(offset + startIdx).map(c => c.close);
  const recentLows = candles.slice(offset + startIdx).map(c => c.low);
  const recentHighs = candles.slice(offset + startIdx).map(c => c.high);

  // Find swing points
  const priceLows = findSwingLows(recentLows);
  const rsiLows = findSwingLows(recentRSI);
  const priceHighs = findSwingHighs(recentHighs);
  const rsiHighs = findSwingHighs(recentRSI);

  // Bullish divergence: price lower low, RSI higher low
  // Look at the last two swing lows
  if (priceLows.length >= 2 && rsiLows.length >= 2) {
    const pL1 = priceLows[priceLows.length - 2];
    const pL2 = priceLows[priceLows.length - 1];
    const rL1 = findClosestSwing(rsiLows, pL1.index);
    const rL2 = findClosestSwing(rsiLows, pL2.index);

    if (rL1 && rL2 && Math.abs(pL2.index - pL1.index) >= 5) {
      if (pL2.value < pL1.value && rL2.value > rL1.value) {
        // Only count if the divergence is recent (last 10 bars from end)
        if (recentLows.length - pL2.index <= 15) {
          return { detected: true, type: 'bullish' };
        }
      }
    }
  }

  // Bearish divergence: price higher high, RSI lower high
  if (priceHighs.length >= 2 && rsiHighs.length >= 2) {
    const pH1 = priceHighs[priceHighs.length - 2];
    const pH2 = priceHighs[priceHighs.length - 1];
    const rH1 = findClosestSwing(rsiHighs, pH1.index);
    const rH2 = findClosestSwing(rsiHighs, pH2.index);

    if (rH1 && rH2 && Math.abs(pH2.index - pH1.index) >= 5) {
      if (pH2.value > pH1.value && rH2.value < rH1.value) {
        if (recentHighs.length - pH2.index <= 15) {
          return { detected: true, type: 'bearish' };
        }
      }
    }
  }

  return { detected: false, type: null };
}

/**
 * Find the swing point closest to a given index.
 */
function findClosestSwing(swings, targetIndex, maxDistance = 5) {
  let best = null;
  let bestDist = Infinity;
  for (const s of swings) {
    const dist = Math.abs(s.index - targetIndex);
    if (dist < bestDist && dist <= maxDistance) {
      best = s;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Full RSI analysis for confluence scoring.
 * @param {Array} candles
 * @returns {{ value: number, condition: string, points: number, divergence: object }}
 */
function analyze(candles) {
  const { values, current } = calculateRSI(candles);

  if (current === null) {
    return {
      value: null,
      condition: 'insufficient_data',
      points: 0,
      divergence: { detected: false, type: null, points: 0 },
    };
  }

  // RSI state scoring (graduated)
  let condition = 'neutral';
  let points = 0;

  if (current <= config.scoring.rsiOversold) {
    condition = 'oversold';
    points = 1.5;
  } else if (current <= config.scoring.rsiNearOversold) {
    condition = 'near_oversold';
    points = 0.75;
  } else if (current >= config.scoring.rsiOverbought) {
    condition = 'overbought';
    points = 1.5;
  } else if (current >= config.scoring.rsiNearOverbought) {
    condition = 'near_overbought';
    points = 0.75;
  }

  // Divergence detection
  const divergence = detectDivergence(candles, values);
  const divPoints = divergence.detected ? 2.0 : 0;

  return {
    value: Math.round(current * 100) / 100,
    condition,
    points,
    divergence: {
      ...divergence,
      points: divPoints,
    },
  };
}

module.exports = { calculateRSI, detectDivergence, findSwingLows, findSwingHighs, analyze };
