#!/usr/bin/env node
/**
 * Walk-Forward Testing — validates strategy params on unseen data.
 *
 * Splits historical data into rolling train/test windows, optimizes params
 * on each training set, then tests on the unseen out-of-sample window.
 *
 * Usage:
 *   node src/walkForward.js --symbol BTCUSDT --csv data/BTCUSDT_15m_5y.csv --htf data/BTCUSDT_4h_5y.csv
 *   node src/walkForward.js --symbol BTCUSDT --csv data/BTCUSDT_15m_5y.csv --htf data/BTCUSDT_4h_5y.csv --grid full
 */

const config = require('./config');
const { buildRegimeLookup } = require('./engine/regimeDetector');
const { getStrategy } = require('./strategies');
const {
  loadCsvCandles,
  backtestSymbol,
  simulateOutcomes,
  computeMetrics,
} = require('./engine/backtestCore');
const { TRADE_GRIDS, INDICATOR_GRIDS, expandGrid, rankScore } = require('./engine/paramGrid');

const MS_PER_DAY = 86400000;

// ─── Parse CLI args ────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    symbol: null,
    csv: null,
    htf: null,
    interval: '15m',
    strategy: 'regime-adaptive',
    trainDays: 365,
    testDays: 90,
    stepDays: 90,
    grid: 'reduced',
    indicatorGrid: null,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--symbol': opts.symbol = args[++i]; break;
      case '--csv': opts.csv = args[++i]; break;
      case '--htf': opts.htf = args[++i]; break;
      case '--interval': opts.interval = args[++i]; break;
      case '--strategy': opts.strategy = args[++i]; break;
      case '--train-days': opts.trainDays = parseInt(args[++i], 10); break;
      case '--test-days': opts.testDays = parseInt(args[++i], 10); break;
      case '--step-days': opts.stepDays = parseInt(args[++i], 10); break;
      case '--grid': opts.grid = args[++i]; break;
      case '--indicator-grid': opts.indicatorGrid = args[++i]; break;
      case '--verbose': case '-v': opts.verbose = true; break;
      case '--help': case '-h':
        printHelp();
        process.exit(0);
    }
  }

  if (!opts.symbol || !opts.csv) {
    console.error('  Required: --symbol and --csv\n  Run with --help for usage.');
    process.exit(1);
  }

  return opts;
}

function printHelp() {
  console.log(`
Walk-Forward Testing — Validate strategy on unseen data

Usage: node src/walkForward.js --symbol BTCUSDT --csv <file> [options]

Required:
  --symbol BTCUSDT         Symbol to test
  --csv <file>             15m candle data CSV

Options:
  --htf <file>             4h candle data for regime detection
  --interval 15m           Timeframe label (default: 15m)
  --strategy <name>        Strategy to test (default: regime-adaptive)
  --train-days 365         Training window in days (default: 365)
  --test-days 90           Out-of-sample test window in days (default: 90)
  --step-days 90           Roll-forward step size in days (default: same as test-days)
  --grid <mode>            Trade param grid: reduced (54 combos), full (400 combos), none (default: reduced)
  --indicator-grid <mode>  Indicator param grid: reduced, full, none (default: none)
  --verbose, -v            Show per-fold detail
  --help, -h               Show this help

Examples:
  node src/walkForward.js --symbol BTCUSDT --csv data/BTCUSDT_15m_5y.csv --htf data/BTCUSDT_4h_5y.csv
  node src/walkForward.js --symbol ETHUSDT --csv data/ETHUSDT_15m_5y.csv --htf data/ETHUSDT_4h_5y.csv --grid full
  node src/walkForward.js --symbol BTCUSDT --csv data/BTCUSDT_15m_5y.csv --htf data/BTCUSDT_4h_5y.csv --indicator-grid reduced
`);
}

// ─── Window Generation ────────────────────────────────────────────

function generateFolds(candles, trainDays, testDays, stepDays) {
  const trainMs = trainDays * MS_PER_DAY;
  const testMs = testDays * MS_PER_DAY;
  const stepMs = stepDays * MS_PER_DAY;

  const dataStart = candles[0].open_time;
  const dataEnd = candles[candles.length - 1].open_time;

  const folds = [];
  let foldStart = dataStart;

  while (foldStart + trainMs + testMs <= dataEnd) {
    folds.push({
      trainStart: foldStart,
      trainEnd: foldStart + trainMs,
      testStart: foldStart + trainMs,
      testEnd: foldStart + trainMs + testMs,
    });
    foldStart += stepMs;
  }

  return folds;
}

function sliceCandles(candles, startTs, endTs, warmupMs) {
  // Include warmup candles before startTs for indicator computation
  const actualStart = startTs - (warmupMs || 0);
  return candles.filter(c => c.open_time >= actualStart && c.open_time < endTs);
}

// ─── Programmatic Walk-Forward API ────────────────────────────────

/**
 * Run walk-forward optimization programmatically.
 * @param {Object} options
 * @param {string} options.symbol
 * @param {string} options.interval
 * @param {Object} options.strategy - strategy module
 * @param {Array}  options.allCandles - loaded candle array
 * @param {Array}  [options.allHtfCandles] - HTF candles for regime detection
 * @param {number} [options.trainDays=365]
 * @param {number} [options.testDays=90]
 * @param {number} [options.stepDays=90]
 * @param {string} [options.tradeGrid='reduced'] - 'reduced', 'full', or 'none'
 * @param {string} [options.indicatorGrid=null] - 'reduced', 'full', or null/none
 * @param {boolean} [options.quiet=false]
 * @returns {{ foldResults: Array, allOosSignals: Array, aggregateOos: Object, paramStability: Object }}
 */
function runWalkForward(options) {
  const {
    symbol,
    interval = '15m',
    strategy,
    allCandles,
    allHtfCandles = null,
    trainDays = 365,
    testDays = 90,
    stepDays = 90,
    tradeGrid = 'reduced',
    indicatorGrid = null,
    quiet = false,
  } = options;

  const folds = generateFolds(allCandles, trainDays, testDays, stepDays);

  if (folds.length === 0) {
    if (!quiet) console.error(`  Not enough data for train=${trainDays}d + test=${testDays}d windows.`);
    return { foldResults: [], allOosSignals: [], aggregateOos: null, paramStability: null };
  }

  // Build grids
  const tradeGridDef = TRADE_GRIDS[tradeGrid];
  const useTradeGrid = !!tradeGridDef;
  const tradeGridCombos = useTradeGrid ? expandGrid(tradeGridDef) : null;

  const indicatorGridDef = indicatorGrid ? INDICATOR_GRIDS[indicatorGrid] : null;
  const indicatorGridCombos = indicatorGridDef ? expandGrid(indicatorGridDef) : [{}]; // single empty combo = use defaults

  // Warmup: 500 candles * 15min = ~5.2 days for 15m candles
  const warmupMs = 500 * 15 * 60 * 1000;
  // HTF warmup: 120 candles * 4h = 20 days
  const htfWarmupMs = 120 * 4 * 60 * 60 * 1000;

  // Get strategy threshold default
  const sp = strategy.tradeParams || {};
  const defaultThreshold = sp.threshold || config.scoring.confluenceThreshold;

  if (!quiet) {
    console.log('\n' + '='.repeat(90));
    console.log(`  WALK-FORWARD TEST — ${symbol} (${strategy.label})`);
    console.log('='.repeat(90));
    console.log(`  Train:      ${trainDays}d | Test: ${testDays}d | Step: ${stepDays}d`);
    console.log(`  Folds:      ${folds.length}`);
    console.log(`  Trade Grid: ${tradeGrid} (${useTradeGrid ? tradeGridCombos.length + ' combos' : 'strategy defaults only'})`);
    console.log(`  Ind. Grid:  ${indicatorGrid || 'none'} (${indicatorGridCombos.length} combos)`);
    console.log(`  Total evals per fold: ${indicatorGridCombos.length * (useTradeGrid ? tradeGridCombos.length : 1)}`);
    console.log('='.repeat(90));
  }

  const foldResults = [];
  const allOosSignals = [];
  const startTime = Date.now();

  for (let fi = 0; fi < folds.length; fi++) {
    const fold = folds[fi];
    const trainLabel = `${fmtDate(fold.trainStart)} → ${fmtDate(fold.trainEnd)}`;
    const testLabel = `${fmtDate(fold.testStart)} → ${fmtDate(fold.testEnd)}`;

    if (!quiet) process.stdout.write(`\n  Fold ${fi + 1}/${folds.length}: train ${trainLabel} | test ${testLabel}`);

    // Slice candles for this fold
    const trainCandles = sliceCandles(allCandles, fold.trainStart, fold.trainEnd, warmupMs);
    const testCandles = sliceCandles(allCandles, fold.testStart, fold.testEnd, warmupMs);

    // Build regime lookups per window (no future leakage)
    let trainRegime = null;
    let testRegime = null;
    if (allHtfCandles) {
      const htfTrain = sliceCandles(allHtfCandles, fold.trainStart, fold.trainEnd, htfWarmupMs);
      const htfTest = sliceCandles(allHtfCandles, fold.testStart, fold.testEnd, htfWarmupMs);
      if (htfTrain.length >= 100) trainRegime = buildRegimeLookup(htfTrain);
      if (htfTest.length >= 100) testRegime = buildRegimeLookup(htfTest);
    }

    let bestScore = -Infinity;
    let bestParams = null;
    let bestIndicatorParams = null;
    let trainMetrics = null;

    // ── Two-level grid: outer = indicator params, inner = trade params ──
    for (const indCombo of indicatorGridCombos) {
      const threshold = indCombo.threshold ?? defaultThreshold;
      const indicatorOverrides = {};
      for (const key of Object.keys(indCombo)) {
        if (key !== 'threshold') indicatorOverrides[key] = indCombo[key];
      }

      const baseOpts = { _quiet: true, threshold, verbose: false, indicatorOverrides };
      const signals = backtestSymbol(symbol, interval, strategy, baseOpts, trainCandles, trainRegime);

      if (signals.length < 3) continue;

      if (useTradeGrid) {
        for (const tradeCombo of tradeGridCombos) {
          const outcomes = simulateOutcomes(trainCandles, signals, tradeCombo);
          const metrics = computeMetrics(outcomes);
          const score = rankScore(metrics);

          if (score > bestScore) {
            bestScore = score;
            bestParams = tradeCombo;
            bestIndicatorParams = { threshold, ...indicatorOverrides };
            trainMetrics = metrics;
          }
        }
      } else {
        // No trade grid — use strategy defaults
        const symParams = (strategy.symbolParams || {})[symbol] || {};
        const defaultTradeParams = {
          riskPct: symParams.riskPct || sp.riskPct || 1.0,
          tp1RR: symParams.tp1RR || sp.tp1RR || 1.5,
          tp2RR: symParams.tp2RR != null ? symParams.tp2RR : (sp.tp2RR != null ? sp.tp2RR : 2.5),
          maxBars: symParams.maxBars || sp.maxBars || 48,
        };
        const outcomes = simulateOutcomes(trainCandles, signals, defaultTradeParams);
        const metrics = computeMetrics(outcomes);
        const score = rankScore(metrics);

        if (score > bestScore) {
          bestScore = score;
          bestParams = defaultTradeParams;
          bestIndicatorParams = { threshold, ...indicatorOverrides };
          trainMetrics = metrics;
        }
      }
    }

    if (!bestParams || !trainMetrics) {
      if (!quiet) process.stdout.write(` — skipped (no viable param set)`);
      foldResults.push({ fold: fi + 1, trainLabel, testLabel, skipped: true, reason: 'no viable params' });
      continue;
    }

    // ── Test on OOS data with best params ──
    const testBaseOpts = {
      _quiet: true,
      threshold: bestIndicatorParams.threshold,
      verbose: false,
      indicatorOverrides: { ...bestIndicatorParams },
    };
    delete testBaseOpts.indicatorOverrides.threshold;

    const testSignals = backtestSymbol(symbol, interval, strategy, testBaseOpts, testCandles, testRegime);
    const testOutcomes = simulateOutcomes(testCandles, testSignals, bestParams);
    const testMetrics = computeMetrics(testOutcomes);

    allOosSignals.push(...testOutcomes);

    // Overfitting ratio
    const overfitRatio = (trainMetrics.profitFactor > 0 && testMetrics.profitFactor > 0)
      ? (trainMetrics.profitFactor === Infinity ? 10 : trainMetrics.profitFactor) /
        (testMetrics.profitFactor === Infinity ? 10 : Math.max(testMetrics.profitFactor, 0.01))
      : null;

    foldResults.push({
      fold: fi + 1,
      trainLabel,
      testLabel,
      bestParams,
      bestIndicatorParams,
      trainMetrics,
      testMetrics,
      overfitRatio,
      skipped: false,
    });

    if (!quiet) {
      const tPF = trainMetrics.profitFactor === Infinity ? '∞' : trainMetrics.profitFactor.toFixed(2);
      const oPF = testMetrics.profitFactor === Infinity ? '∞' : testMetrics.profitFactor.toFixed(2);
      process.stdout.write(`\n    Train: ${trainMetrics.total} sig, ${trainMetrics.winRate.toFixed(0)}% WR, PF=${tPF}, ${trainMetrics.totalPnl.toFixed(1)}R`);
      process.stdout.write(`\n    Test:  ${testMetrics.total} sig, ${testMetrics.winRate.toFixed(0)}% WR, PF=${oPF}, ${testMetrics.totalPnl.toFixed(1)}R`);
      process.stdout.write(`\n    Trade:  risk=${bestParams.riskPct}% tp1=${bestParams.tp1RR}R tp2=${bestParams.tp2RR}R mb=${bestParams.maxBars}`);
      if (Object.keys(bestIndicatorParams).length > 1 || bestIndicatorParams.threshold !== defaultThreshold) {
        process.stdout.write(`\n    Ind:    ${JSON.stringify(bestIndicatorParams)}`);
      }
      if (overfitRatio != null) process.stdout.write(` | Overfit: ${overfitRatio.toFixed(2)}x`);
    }
  }

  // ─── Aggregate Results ────────────────────────────────────────
  const activeFolds = foldResults.filter(f => !f.skipped);
  let aggregateOos = null;
  let paramStability = null;

  if (allOosSignals.length > 0) {
    aggregateOos = computeMetrics(allOosSignals);

    // Overfit ratio stats
    const ofRatios = activeFolds.filter(f => f.overfitRatio != null).map(f => f.overfitRatio);
    if (ofRatios.length > 0) {
      aggregateOos.avgOverfitRatio = ofRatios.reduce((a, b) => a + b, 0) / ofRatios.length;
    }
    aggregateOos.profitableFolds = activeFolds.filter(f => f.testMetrics.totalPnl > 0).length;
    aggregateOos.totalFolds = activeFolds.length;
  }

  // Parameter stability
  if (activeFolds.length >= 3 && activeFolds[0].bestParams) {
    const allKeys = new Set();
    for (const f of activeFolds) {
      for (const key of Object.keys(f.bestParams)) allKeys.add(key);
      if (f.bestIndicatorParams) {
        for (const key of Object.keys(f.bestIndicatorParams)) allKeys.add(key);
      }
    }

    paramStability = {};
    for (const key of allKeys) {
      const vals = activeFolds.map(f => {
        if (f.bestParams[key] != null) return f.bestParams[key];
        if (f.bestIndicatorParams && f.bestIndicatorParams[key] != null) return f.bestIndicatorParams[key];
        return null;
      }).filter(v => v != null);

      if (vals.length > 0) {
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
        paramStability[key] = { mean: +mean.toFixed(3), std: +Math.sqrt(variance).toFixed(3) };
      }
    }
  }

  if (!quiet) {
    printResults(foldResults, activeFolds, allOosSignals, aggregateOos, paramStability, startTime, folds.length);
  }

  return { foldResults, allOosSignals, aggregateOos, paramStability };
}

// ─── Console Output ───────────────────────────────────────────────

function printResults(foldResults, activeFolds, allOosSignals, aggregateOos, paramStability, startTime, totalFoldCount) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n\n' + '='.repeat(90));
  console.log('  WALK-FORWARD RESULTS');
  console.log('='.repeat(90));

  // Per-fold table
  console.log(`\n  ${'Fold'.padEnd(5)} ${'Train Period'.padEnd(24)} ${'Test Period'.padEnd(24)} ${'TrainWR'.padStart(8)} ${'TestWR'.padStart(8)} ${'TrainPF'.padStart(8)} ${'TestPF'.padStart(8)} ${'TestR'.padStart(8)} ${'OF'.padStart(6)}`);
  console.log('  ' + '-'.repeat(97));

  for (const f of foldResults) {
    if (f.skipped) {
      console.log(`  ${String(f.fold).padEnd(5)} ${f.trainLabel.padEnd(24)} ${f.testLabel.padEnd(24)} ${'— skipped: ' + f.reason}`);
      continue;
    }
    const tWR = f.trainMetrics.winRate.toFixed(1) + '%';
    const oWR = f.testMetrics.winRate.toFixed(1) + '%';
    const tPF = f.trainMetrics.profitFactor === Infinity ? '∞' : f.trainMetrics.profitFactor.toFixed(2);
    const oPF = f.testMetrics.profitFactor === Infinity ? '∞' : f.testMetrics.profitFactor.toFixed(2);
    const oR = (f.testMetrics.totalPnl >= 0 ? '+' : '') + f.testMetrics.totalPnl.toFixed(1) + 'R';
    const of_ = f.overfitRatio != null ? f.overfitRatio.toFixed(2) + 'x' : '-';
    console.log(`  ${String(f.fold).padEnd(5)} ${f.trainLabel.padEnd(24)} ${f.testLabel.padEnd(24)} ${tWR.padStart(8)} ${oWR.padStart(8)} ${tPF.padStart(8)} ${oPF.padStart(8)} ${oR.padStart(8)} ${of_.padStart(6)}`);
  }

  // Aggregate OOS
  console.log('\n' + '='.repeat(90));
  console.log('  AGGREGATE OUT-OF-SAMPLE');
  console.log('='.repeat(90));

  if (!aggregateOos || allOosSignals.length === 0) {
    console.log('\n  No OOS signals generated across any fold.');
  } else {
    console.log(`\n  Total OOS Signals:  ${aggregateOos.total}`);
    console.log(`  OOS Wins:           ${aggregateOos.wins} (TP1: ${aggregateOos.tp1}, TP2: ${aggregateOos.tp2})`);
    console.log(`  OOS Losses:         ${aggregateOos.losses}`);
    console.log(`  OOS Expired:        ${aggregateOos.expired}`);
    console.log(`  OOS Win Rate:       ${aggregateOos.winRate.toFixed(1)}%`);
    console.log(`  OOS Total R:        ${aggregateOos.totalPnl.toFixed(1)}R`);
    console.log(`  OOS Avg R/Signal:   ${aggregateOos.avgPnl.toFixed(3)}R`);
    console.log(`  OOS Profit Factor:  ${aggregateOos.profitFactor === Infinity ? '∞' : aggregateOos.profitFactor.toFixed(2)}`);
    console.log(`  OOS Max Consec L:   ${aggregateOos.maxConsecLoss}`);

    if (aggregateOos.avgOverfitRatio != null) {
      const avgOF = aggregateOos.avgOverfitRatio;
      console.log(`\n  Avg Overfit Ratio:  ${avgOF.toFixed(2)}x ${avgOF < 1.5 ? '(good)' : avgOF < 2.5 ? '(moderate)' : '(high — possible overfitting)'}`);
    }

    if (paramStability) {
      console.log(`\n  Parameter Stability (mean ± σ):`);
      for (const [key, stat] of Object.entries(paramStability)) {
        console.log(`    ${key.padEnd(24)} ${stat.mean} ± ${stat.std}`);
      }
    }

    if (aggregateOos.profitableFolds != null) {
      console.log(`\n  Profitable Folds:   ${aggregateOos.profitableFolds}/${aggregateOos.totalFolds} (${(aggregateOos.profitableFolds / aggregateOos.totalFolds * 100).toFixed(0)}%)`);
    }
  }

  console.log(`\n  Elapsed: ${elapsed}s | Folds: ${totalFoldCount} (${activeFolds.length} active)`);
  console.log('='.repeat(90) + '\n');
}

// ─── Helpers ──────────────────────────────────────────────────────

function fmtDate(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

// ─── CLI Entry Point ──────────────────────────────────────────────

function main() {
  const opts = parseArgs();
  const strategy = getStrategy(opts.strategy);

  // Load data
  console.log(`\n  Loading candle data...`);
  const allCandles = loadCsvCandles(opts.csv);

  let allHtfCandles = null;
  if (opts.htf) {
    console.log(`  Loading HTF data for regime detection...`);
    allHtfCandles = loadCsvCandles(opts.htf);
  }

  console.log(`  Data:       ${opts.csv}`);
  console.log(`  HTF:        ${opts.htf || 'none'}`);

  runWalkForward({
    symbol: opts.symbol,
    interval: opts.interval,
    strategy,
    allCandles,
    allHtfCandles,
    trainDays: opts.trainDays,
    testDays: opts.testDays,
    stepDays: opts.stepDays,
    tradeGrid: opts.grid,
    indicatorGrid: opts.indicatorGrid,
    quiet: false,
  });
}

// Run CLI if executed directly
if (require.main === module) {
  main();
}

module.exports = { runWalkForward, generateFolds, sliceCandles };
