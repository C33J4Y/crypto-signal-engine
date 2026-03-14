/**
 * Strategy-aware scorer for the live engine.
 * Bridges strategy.evaluate() output → signalGenerator.generate() input format.
 */

const db = require('../db/database');
const config = require('../config');
const rsi = require('../indicators/rsi');
const fvg = require('../indicators/fvg');
const volumeProfile = require('../indicators/volumeProfile');
const volume = require('../indicators/volume');
const smaRibbon = require('../indicators/smaRibbon');
const logger = require('../utils/logger');

/**
 * Score all symbols/timeframes using the given strategy.
 * Returns qualified setups in the same format as confluenceScorer.scoreAll().
 */
function scoreAllWithStrategy(strategy, regimes) {
  const results = [];
  const allScores = []; // Forward-test: capture ALL scores
  const sp = strategy.tradeParams || {};

  for (const symbol of config.symbols) {
    const symParams = (strategy.symbolParams && strategy.symbolParams[symbol]) || {};
    const threshold = symParams.threshold ?? sp.threshold ?? config.scoring.confluenceThreshold;

    for (const interval of config.timeframes) {
      try {
        const candles = db.getCandles(symbol, interval, 500);

        if (candles.length < 100) {
          logger.warn('Insufficient candle data for scoring', { symbol, interval, count: candles.length });
          continue;
        }

        // Run all indicators
        const rsiResult = rsi.analyze(candles);
        const fvgResult = fvg.analyze(candles, symbol, interval);
        const vpResult = volumeProfile.analyze(candles);
        const volResult = volume.analyze(candles);
        const smaResult = smaRibbon.analyze(candles);

        const indicators = {
          rsi: rsiResult,
          fvg: fvgResult,
          volumeProfile: vpResult,
          volume: volResult,
          smaRibbon: smaResult,
        };

        // Build regime context for strategy
        const regime = regimes ? regimes[symbol] : null;
        const currentCandle = candles[candles.length - 1];
        const opts = { currentRegime: regime, threshold };

        // Let the strategy evaluate
        const result = strategy.evaluate(currentCandle, indicators, opts);

        const minThreshold = config.scoring.watchlistThreshold;

        // Forward-test: log even sub-threshold scores
        if (result && result.direction) {
          const grade = classifyGrade(result.points, threshold);
          allScores.push({
            symbol,
            interval,
            direction: result.direction,
            score: result.points,
            grade,
            fired: result.fired || [],
            regime: regime?.regime || 'unknown',
            rejectionReason: result.points < minThreshold ? 'below_threshold' : null,
          });
        }

        if (!result || !result.direction || result.points < minThreshold) continue;

        // Convert strategy output to confluenceScorer-compatible format
        const grade = classifyGrade(result.points, threshold);
        const setup = {
          direction: result.direction,
          totalPoints: result.points,
          grade,
          breakdown: buildBreakdown(result, indicators),
        };

        if (grade === 'A+' || grade === 'B') {
          results.push({ symbol, interval, setup, candles, indicators });
        }

        if (grade === 'B') {
          logger.debug(`Watchlist [${strategy.name}]: ${symbol}/${interval} ${result.direction}`, {
            score: result.points,
            fired: result.fired,
          });
        }
      } catch (err) {
        logger.error(`Strategy scoring failed for ${symbol}/${interval}`, { error: err.message });
      }
    }
  }

  return { results, allScores };
}

/**
 * Build a breakdown object compatible with signalGenerator from strategy result + indicators.
 */
function buildBreakdown(result, indicators) {
  const fired = new Set(result.fired || []);
  const breakdown = {};

  // RSI (use actual indicator points for graduated scoring)
  breakdown.rsi = {
    value: indicators.rsi.value,
    condition: indicators.rsi.condition,
    points: (fired.has('RSI-OS') || fired.has('RSI-OB')) ? indicators.rsi.points : 0,
  };

  // RSI Divergence
  breakdown.rsiDivergence = {
    detected: fired.has('RSI-Div'),
    type: indicators.rsi.divergence.type,
    points: fired.has('RSI-Div') ? 2.0 : 0,
  };

  // FVG
  if (fired.has('FVG') && indicators.fvg.active) {
    breakdown.fvg = {
      active: true,
      direction: indicators.fvg.direction,
      zoneHigh: indicators.fvg.zoneHigh,
      zoneLow: indicators.fvg.zoneLow,
      points: 2.0,
    };
  } else {
    breakdown.fvg = { active: false, direction: null, points: 0 };
  }

  // Volume Profile POC (graduated)
  breakdown.volumeProfilePOC = {
    poc: indicators.volumeProfile.poc,
    distance: indicators.volumeProfile.distance,
    points: fired.has('POC') ? indicators.volumeProfile.points : 0,
  };

  // Volume Spike (graduated)
  breakdown.volumeSpike = {
    current: indicators.volume.current,
    average: indicators.volume.average,
    ratio: indicators.volume.ratio,
    points: (fired.has('Vol') || fired.has('Vol-3x')) ? indicators.volume.points : 0,
  };

  // SMA Ribbon
  breakdown.smaRibbon = {
    sma50: indicators.smaRibbon.sma50,
    sma100: indicators.smaRibbon.sma100,
    alignment: indicators.smaRibbon.alignment,
    points: fired.has('SMA') ? 1.5 : 0,
  };
  if (fired.has('SMA-PB')) {
    breakdown.smaRibbon.pullback = true;
    breakdown.smaRibbon.points += 0.5;
  }

  return breakdown;
}

function classifyGrade(score, threshold) {
  if (score >= threshold) return 'A+';
  if (score >= config.scoring.watchlistThreshold) return 'B';
  return 'C';
}

module.exports = { scoreAllWithStrategy };
