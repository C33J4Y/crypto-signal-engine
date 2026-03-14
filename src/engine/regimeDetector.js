const config = require('../config');
const logger = require('../utils/logger');

/**
 * Detect market regime from higher-timeframe candle data.
 *
 * Uses SMA50/SMA100 on HTF candles to classify:
 *   - trending_bull: SMA50 > SMA100, spread > threshold
 *   - trending_bear: SMA50 < SMA100, spread > threshold
 *   - ranging: SMAs within threshold of each other
 *
 * @param {Array} htfCandles - Higher-timeframe candles (e.g. 4h), chronological order
 * @returns {{ regime: string, smaFast: number, smaSlow: number, spread: number } | null}
 */
function detectRegime(htfCandles) {
  const fastPeriod = config.scoring.smaFast;
  const slowPeriod = config.scoring.smaSlow;

  if (htfCandles.length < slowPeriod) {
    logger.warn('Insufficient HTF candles for regime detection', {
      have: htfCandles.length,
      need: slowPeriod,
    });
    return null;
  }

  const closes = htfCandles.map(c => c.close);

  let sumFast = 0;
  for (let i = closes.length - fastPeriod; i < closes.length; i++) sumFast += closes[i];
  const smaFast = sumFast / fastPeriod;

  let sumSlow = 0;
  for (let i = closes.length - slowPeriod; i < closes.length; i++) sumSlow += closes[i];
  const smaSlow = sumSlow / slowPeriod;

  const spread = Math.abs(smaFast - smaSlow) / smaSlow * 100;
  const threshold = config.regime.rangingThresholdPct;

  let regime;
  if (spread <= threshold) {
    regime = 'ranging';
  } else if (smaFast > smaSlow) {
    regime = 'trending_bull';
  } else {
    regime = 'trending_bear';
  }

  return { regime, smaFast, smaSlow, spread: Math.round(spread * 100) / 100 };
}

/**
 * Check if a signal direction is allowed under the current regime for a symbol.
 *
 * @param {string} symbol
 * @param {string} direction - 'LONG' or 'SHORT'
 * @param {string} regime - 'trending_bull', 'trending_bear', or 'ranging'
 * @returns {boolean}
 */
function isDirectionAllowed(symbol, direction, regime) {
  const profile = config.getSymbolProfile(symbol);
  const allowed = profile.regimeFilter?.[regime];

  if (!allowed) return false;
  return allowed.includes(direction);
}

/**
 * Build a regime lookup function from an array of HTF candles (for backtesting).
 * Pre-computes regime for each candle and returns a binary-search function.
 *
 * @param {Array} htfCandles - Full history of HTF candles
 * @returns {function(timestamp): { regime, smaFast, smaSlow, spread } | null}
 */
function buildRegimeLookup(htfCandles) {
  const fastPeriod = config.scoring.smaFast;
  const slowPeriod = config.scoring.smaSlow;
  const threshold = config.regime.rangingThresholdPct;

  const entries = [];
  for (let i = slowPeriod - 1; i < htfCandles.length; i++) {
    let sumFast = 0, sumSlow = 0;
    for (let j = i - fastPeriod + 1; j <= i; j++) sumFast += htfCandles[j].close;
    for (let j = i - slowPeriod + 1; j <= i; j++) sumSlow += htfCandles[j].close;
    const smaFast = sumFast / fastPeriod;
    const smaSlow = sumSlow / slowPeriod;
    const spread = Math.abs(smaFast - smaSlow) / smaSlow * 100;

    let regime;
    if (spread <= threshold) regime = 'ranging';
    else if (smaFast > smaSlow) regime = 'trending_bull';
    else regime = 'trending_bear';

    entries.push({ open_time: htfCandles[i].open_time, regime, smaFast, smaSlow, spread });
  }

  return function getRegimeAt(timestamp) {
    let lo = 0, hi = entries.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (entries[mid].open_time <= timestamp) lo = mid + 1;
      else hi = mid - 1;
    }
    return hi >= 0 ? entries[hi] : null;
  };
}

module.exports = { detectRegime, isDirectionAllowed, buildRegimeLookup };
