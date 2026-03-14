const db = require('../db/database');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Generate a full signal with entry, SL, TP levels from a scored setup.
 *
 * @param {string} symbol
 * @param {string} interval
 * @param {object} setup - Scored setup from confluenceScorer (long or short)
 * @param {Array} candles - Candle data
 * @param {object} indicators - Raw indicator results
 * @returns {object|null} Signal object or null if R:R is insufficient
 */
function generate(symbol, interval, setup, candles, indicators) {
  // Check cooldown
  if (isOnCooldown(symbol, interval, setup.direction)) {
    logger.debug('Signal on cooldown, skipping', { symbol, interval, direction: setup.direction });
    return null;
  }

  const profile = config.getSymbolProfile(symbol);
  const currentCandle = candles[candles.length - 1];
  const entry = computeEntry(setup, currentCandle, indicators);
  const stopLoss = computeStopLoss(setup.direction, candles, indicators, profile);
  const risk = Math.abs(entry - stopLoss);

  if (risk === 0) {
    logger.warn('Zero risk calculated, skipping signal', { symbol, interval });
    return null;
  }

  const tp1 = profile.tp1RR > 0 ? computeTP(entry, risk, profile.tp1RR, setup.direction) : entry;
  const tp2 = profile.tp2RR > 0 ? computeTP(entry, risk, profile.tp2RR, setup.direction) : tp1;
  const tp3 = profile.tp3RR > 0 ? computeTP(entry, risk, profile.tp3RR, setup.direction) : tp2;

  // Validate minimum R:R using the highest active TP
  const bestTP = tp3 || tp2 || tp1;
  const rrRatio = bestTP ? Math.abs(bestTP - entry) / risk : 0;
  if (rrRatio < profile.minRiskReward) {
    logger.debug('Insufficient R:R, skipping signal', { symbol, interval, rr: rrRatio.toFixed(2) });
    return null;
  }

  const bestRR = profile.tp2RR || profile.tp1RR;
  const now = new Date();
  const signal = {
    id: generateSignalId(symbol, interval, now),
    timestamp: now.toISOString(),
    symbol,
    interval,
    direction: setup.direction,
    grade: setup.grade,
    confluenceScore: setup.totalPoints,
    entry: round(entry),
    stopLoss: round(stopLoss),
    tp1: tp1 ? round(tp1) : null,
    tp2: tp2 ? round(tp2) : null,
    tp3: tp3 ? round(tp3) : null,
    riskReward: `1:${bestRR}`,
    indicators: setup.breakdown,
    notes: generateNotes(setup),
  };

  // Store in database
  db.insertSignal(signal);
  logger.info(`SIGNAL GENERATED: ${signal.direction} ${symbol}/${interval}`, {
    grade: signal.grade,
    score: signal.confluenceScore,
    entry: signal.entry,
    sl: signal.stopLoss,
    tp1: signal.tp1,
    tp2: signal.tp2,
    tp3: signal.tp3,
  });

  return signal;
}

/**
 * Compute entry price.
 */
function computeEntry(setup, currentCandle, indicators) {
  // If FVG contributed, use midpoint of FVG zone
  if (setup.breakdown.fvg && setup.breakdown.fvg.active) {
    const fvgMid = (setup.breakdown.fvg.zoneHigh + setup.breakdown.fvg.zoneLow) / 2;
    return fvgMid;
  }
  // Otherwise use current close
  return currentCandle.close;
}

/**
 * Compute stop-loss from support/resistance candidates.
 */
function computeStopLoss(direction, candles, indicators, profile) {
  const candidates = [];
  const currentPrice = candles[candles.length - 1].close;

  if (direction === 'LONG') {
    // Below FVG zone low
    if (indicators.fvg && indicators.fvg.active && indicators.fvg.direction === 'bullish') {
      candidates.push(indicators.fvg.zoneLow * 0.999); // Slight buffer below
    }

    // Below VAL
    if (indicators.volumeProfile && indicators.volumeProfile.val) {
      candidates.push(indicators.volumeProfile.val * 0.999);
    }

    // Below 100 SMA
    if (indicators.smaRibbon && indicators.smaRibbon.sma100) {
      candidates.push(indicators.smaRibbon.sma100 * 0.999);
    }

    // Below recent swing low (last 20 candles)
    const recentCandles = candles.slice(-20);
    const recentLow = Math.min(...recentCandles.map(c => c.low));
    candidates.push(recentLow * 0.999);

    // Pick the tightest SL that gives >= 1:2 R:R
    const validSLs = candidates
      .filter(sl => sl < currentPrice)
      .sort((a, b) => b - a); // Highest (tightest) first

    for (const sl of validSLs) {
      const risk = currentPrice - sl;
      if (risk > 0) return sl;
    }

    // Fallback: use profile risk% below entry
    return currentPrice * (1 - profile.riskPct / 100);
  } else {
    // SHORT: above resistance
    if (indicators.fvg && indicators.fvg.active && indicators.fvg.direction === 'bearish') {
      candidates.push(indicators.fvg.zoneHigh * 1.001);
    }

    if (indicators.volumeProfile && indicators.volumeProfile.vah) {
      candidates.push(indicators.volumeProfile.vah * 1.001);
    }

    if (indicators.smaRibbon && indicators.smaRibbon.sma100) {
      candidates.push(indicators.smaRibbon.sma100 * 1.001);
    }

    const recentCandles = candles.slice(-20);
    const recentHigh = Math.max(...recentCandles.map(c => c.high));
    candidates.push(recentHigh * 1.001);

    const validSLs = candidates
      .filter(sl => sl > currentPrice)
      .sort((a, b) => a - b); // Lowest (tightest) first

    for (const sl of validSLs) {
      const risk = sl - currentPrice;
      if (risk > 0) return sl;
    }

    return currentPrice * (1 + profile.riskPct / 100);
  }
}

/**
 * Compute take-profit at a given R:R ratio.
 */
function computeTP(entry, risk, rrRatio, direction) {
  if (direction === 'LONG') {
    return entry + risk * rrRatio;
  } else {
    return entry - risk * rrRatio;
  }
}

/**
 * Check if a signal was recently emitted (cooldown period).
 */
function isOnCooldown(symbol, interval, direction) {
  const recent = db.getRecentSignal(symbol, interval, direction);
  if (!recent) return false;

  const cooldownMs = getCooldownMs(interval);
  const signalTime = new Date(recent.created_at).getTime();
  const now = Date.now();

  return (now - signalTime) < cooldownMs;
}

/**
 * Get cooldown duration in ms based on timeframe.
 */
function getCooldownMs(interval) {
  const candleDurationMs = interval === '15m' ? 15 * 60 * 1000 : 60 * 60 * 1000;
  return candleDurationMs * config.scoring.signalCooldownCandles;
}

/**
 * Generate unique signal ID.
 */
function generateSignalId(symbol, interval, date) {
  const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
  const timeStr = date.toISOString().split('T')[1].replace(/:/g, '').slice(0, 6);
  const sym = symbol.replace('USDT', '').toLowerCase();
  return `sig_${dateStr}_${sym}_${interval}_${timeStr}`;
}

/**
 * Generate human-readable notes from the setup.
 */
function generateNotes(setup) {
  const parts = [];

  if (setup.breakdown.fvg && setup.breakdown.fvg.active) {
    parts.push(`${setup.breakdown.fvg.direction} FVG retest`);
  }
  if (setup.breakdown.rsiDivergence && setup.breakdown.rsiDivergence.detected) {
    parts.push(`RSI ${setup.breakdown.rsiDivergence.type} divergence`);
  }
  if (setup.breakdown.rsi && setup.breakdown.rsi.points > 0) {
    parts.push(`RSI ${setup.breakdown.rsi.condition}`);
  }
  if (setup.breakdown.volumeProfilePOC && setup.breakdown.volumeProfilePOC.points > 0) {
    parts.push(`at volume profile POC`);
  }
  if (setup.breakdown.volumeSpike && setup.breakdown.volumeSpike.points > 0) {
    parts.push(`strong volume confirmation`);
  }
  if (setup.breakdown.smaRibbon && setup.breakdown.smaRibbon.points > 0) {
    parts.push(`${setup.breakdown.smaRibbon.alignment} SMA ribbon alignment`);
  }

  return parts.join(' with ') + '.' || 'Multi-indicator confluence signal.';
}

function round(value) {
  return Math.round(value * 100) / 100;
}

module.exports = { generate };
