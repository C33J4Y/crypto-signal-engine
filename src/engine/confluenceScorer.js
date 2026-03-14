const rsi = require('../indicators/rsi');
const fvg = require('../indicators/fvg');
const volumeProfile = require('../indicators/volumeProfile');
const volume = require('../indicators/volume');
const smaRibbon = require('../indicators/smaRibbon');
const db = require('../db/database');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Run all indicators and compute confluence score for a symbol/timeframe.
 * Evaluates both LONG and SHORT setups.
 *
 * @param {string} symbol
 * @param {string} interval
 * @returns {{ long: object|null, short: object|null }}
 */
function score(symbol, interval) {
  const candles = db.getCandles(symbol, interval, 500);

  if (candles.length < 100) {
    logger.warn('Insufficient candle data for scoring', { symbol, interval, count: candles.length });
    return { long: null, short: null };
  }

  // Run all indicators
  const rsiResult = rsi.analyze(candles);
  const fvgResult = fvg.analyze(candles, symbol, interval);
  const vpResult = volumeProfile.analyze(candles);
  const volResult = volume.analyze(candles);
  const smaResult = smaRibbon.analyze(candles);

  // Evaluate LONG setup
  const longScore = evaluateLong(rsiResult, fvgResult, vpResult, volResult, smaResult);

  // Evaluate SHORT setup
  const shortScore = evaluateShort(rsiResult, fvgResult, vpResult, volResult, smaResult);

  return {
    long: longScore,
    short: shortScore,
    candles,
    indicators: { rsi: rsiResult, fvg: fvgResult, volumeProfile: vpResult, volume: volResult, smaRibbon: smaResult },
  };
}

/**
 * Evaluate LONG confluence score.
 */
function evaluateLong(rsiResult, fvgResult, vpResult, volResult, smaResult) {
  let totalPoints = 0;
  const breakdown = {};

  // RSI oversold (+1.5) or near-oversold (+0.75)
  if (rsiResult.condition === 'oversold' || rsiResult.condition === 'near_oversold') {
    totalPoints += rsiResult.points;
    breakdown.rsi = { value: rsiResult.value, condition: rsiResult.condition, points: rsiResult.points };
  } else {
    breakdown.rsi = { value: rsiResult.value, condition: rsiResult.condition, points: 0 };
  }

  // RSI bullish divergence (+2.0)
  if (rsiResult.divergence.detected && rsiResult.divergence.type === 'bullish') {
    totalPoints += 2.0;
    breakdown.rsiDivergence = { detected: true, type: 'bullish', points: 2.0 };
  } else {
    breakdown.rsiDivergence = { detected: false, type: null, points: 0 };
  }

  // Bullish FVG (+2.0)
  if (fvgResult.active && fvgResult.direction === 'bullish') {
    totalPoints += 2.0;
    breakdown.fvg = {
      active: true, direction: 'bullish',
      zoneHigh: fvgResult.zoneHigh, zoneLow: fvgResult.zoneLow,
      points: 2.0,
    };
  } else {
    breakdown.fvg = { active: false, direction: null, points: 0 };
  }

  // Volume Profile POC proximity (+1.5 at POC, +0.75 near)
  if (vpResult.points > 0) {
    totalPoints += vpResult.points;
    breakdown.volumeProfilePOC = {
      poc: vpResult.poc, distance: vpResult.distance, points: vpResult.points,
    };
  } else {
    breakdown.volumeProfilePOC = {
      poc: vpResult.poc, distance: vpResult.distance, points: 0,
    };
  }

  // Volume spike (+1.0) or elevated (+0.5)
  if (volResult.points > 0) {
    totalPoints += volResult.points;
    breakdown.volumeSpike = {
      current: volResult.current, average: volResult.average,
      ratio: volResult.ratio, points: volResult.points,
    };
  } else {
    breakdown.volumeSpike = {
      current: volResult.current, average: volResult.average,
      ratio: volResult.ratio, points: 0,
    };
  }

  // SMA Ribbon bullish trend (+1.5)
  if (smaResult.alignment === 'bullish') {
    totalPoints += 1.5;
    breakdown.smaRibbon = {
      sma50: smaResult.sma50, sma100: smaResult.sma100,
      alignment: 'bullish', points: 1.5,
    };

    // SMA pullback bonus (+0.5)
    if (smaResult.pullback) {
      totalPoints += 0.5;
      breakdown.smaRibbon.pullback = true;
      breakdown.smaRibbon.points += 0.5;
    }
  } else {
    breakdown.smaRibbon = {
      sma50: smaResult.sma50, sma100: smaResult.sma100,
      alignment: smaResult.alignment, points: 0,
    };
  }

  const grade = classifyGrade(totalPoints);

  return {
    direction: 'LONG',
    totalPoints: Math.round(totalPoints * 10) / 10,
    grade,
    breakdown,
  };
}

/**
 * Evaluate SHORT confluence score.
 */
function evaluateShort(rsiResult, fvgResult, vpResult, volResult, smaResult) {
  let totalPoints = 0;
  const breakdown = {};

  // RSI overbought (+1.5) or near-overbought (+0.75)
  if (rsiResult.condition === 'overbought' || rsiResult.condition === 'near_overbought') {
    totalPoints += rsiResult.points;
    breakdown.rsi = { value: rsiResult.value, condition: rsiResult.condition, points: rsiResult.points };
  } else {
    breakdown.rsi = { value: rsiResult.value, condition: rsiResult.condition, points: 0 };
  }

  // RSI bearish divergence (+2.0)
  if (rsiResult.divergence.detected && rsiResult.divergence.type === 'bearish') {
    totalPoints += 2.0;
    breakdown.rsiDivergence = { detected: true, type: 'bearish', points: 2.0 };
  } else {
    breakdown.rsiDivergence = { detected: false, type: null, points: 0 };
  }

  // Bearish FVG (+2.0)
  if (fvgResult.active && fvgResult.direction === 'bearish') {
    totalPoints += 2.0;
    breakdown.fvg = {
      active: true, direction: 'bearish',
      zoneHigh: fvgResult.zoneHigh, zoneLow: fvgResult.zoneLow,
      points: 2.0,
    };
  } else {
    breakdown.fvg = { active: false, direction: null, points: 0 };
  }

  // Volume Profile POC proximity (+1.5) — same for both directions
  if (vpResult.points > 0) {
    totalPoints += 1.5;
    breakdown.volumeProfilePOC = {
      poc: vpResult.poc, distance: vpResult.distance, points: 1.5,
    };
  } else {
    breakdown.volumeProfilePOC = {
      poc: vpResult.poc, distance: vpResult.distance, points: 0,
    };
  }

  // Volume spike (+1.0) or elevated (+0.5)
  if (volResult.points > 0) {
    totalPoints += volResult.points;
    breakdown.volumeSpike = {
      current: volResult.current, average: volResult.average,
      ratio: volResult.ratio, points: volResult.points,
    };
  } else {
    breakdown.volumeSpike = {
      current: volResult.current, average: volResult.average,
      ratio: volResult.ratio, points: 0,
    };
  }

  // SMA Ribbon bearish trend (+1.5)
  if (smaResult.alignment === 'bearish') {
    totalPoints += 1.5;
    breakdown.smaRibbon = {
      sma50: smaResult.sma50, sma100: smaResult.sma100,
      alignment: 'bearish', points: 1.5,
    };

    // SMA pullback bonus (+0.5)
    if (smaResult.pullback) {
      totalPoints += 0.5;
      breakdown.smaRibbon.pullback = true;
      breakdown.smaRibbon.points += 0.5;
    }
  } else {
    breakdown.smaRibbon = {
      sma50: smaResult.sma50, sma100: smaResult.sma100,
      alignment: smaResult.alignment, points: 0,
    };
  }

  const grade = classifyGrade(totalPoints);

  return {
    direction: 'SHORT',
    totalPoints: Math.round(totalPoints * 10) / 10,
    grade,
    breakdown,
  };
}

/**
 * Classify confluence score into grade.
 */
function classifyGrade(score) {
  if (score >= config.scoring.confluenceThreshold) return 'A+';
  if (score >= config.scoring.watchlistThreshold) return 'B';
  return 'C';
}

/**
 * Run scoring for all configured symbols/timeframes.
 * Returns only setups that meet the threshold.
 */
function scoreAll() {
  const results = [];

  for (const symbol of config.symbols) {
    for (const interval of config.timeframes) {
      try {
        const { long, short, candles, indicators } = score(symbol, interval);

        if (long && (long.grade === 'A+' || long.grade === 'B')) {
          results.push({ symbol, interval, setup: long, candles, indicators });
        }
        if (short && (short.grade === 'A+' || short.grade === 'B')) {
          results.push({ symbol, interval, setup: short, candles, indicators });
        }

        // Log watchlist-level setups
        if (long && long.grade === 'B') {
          logger.debug(`Watchlist: ${symbol}/${interval} LONG`, { score: long.totalPoints });
        }
        if (short && short.grade === 'B') {
          logger.debug(`Watchlist: ${symbol}/${interval} SHORT`, { score: short.totalPoints });
        }
      } catch (err) {
        logger.error(`Scoring failed for ${symbol}/${interval}`, { error: err.message });
      }
    }
  }

  return results;
}

module.exports = { score, scoreAll, classifyGrade };
