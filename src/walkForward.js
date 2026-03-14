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
  --grid <mode>            Param grid: reduced (36 combos), full (400 combos), none (default: reduced)
  --verbose, -v            Show per-fold detail
  --help, -h               Show this help

Examples:
  node src/walkForward.js --symbol BTCUSDT --csv data/BTCUSDT_15m_5y.csv --htf data/BTCUSDT_4h_5y.csv
  node src/walkForward.js --symbol ETHUSDT --csv data/ETHUSDT_15m_5y.csv --htf data/ETHUSDT_4h_5y.csv --grid full
`);
}

// ─── Param Grids ──────────────────────────────────────────────────

const GRIDS = {
  full: {
    riskPct: [0.3, 0.5, 0.75, 1.0, 1.5],
    tp1RR: [0.8, 1.0, 1.2, 1.5, 2.0],
    tp2RR: [0, 2.0, 2.5, 3.0],
    maxBars: [12, 24, 48, 96],
  },
  reduced: {
    riskPct: [0.3, 0.75, 1.0],
    tp1RR: [1.0, 1.5, 2.0],
    tp2RR: [0, 2.0, 2.5],
    maxBars: [48, 96],
  },
};

function expandGrid(gridDef) {
  const combos = [];
  for (const riskPct of gridDef.riskPct) {
    for (const tp1RR of gridDef.tp1RR) {
      for (const tp2RR of gridDef.tp2RR) {
        for (const maxBars of gridDef.maxBars) {
          combos.push({ riskPct, tp1RR, tp2RR, maxBars });
        }
      }
    }
  }
  return combos;
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

// ─── Scoring function for ranking params ──────────────────────────

function rankScore(metrics) {
  // Reward profitability + statistical significance
  if (metrics.total < 5 || metrics.profitFactor === 0) return -Infinity;
  const pf = metrics.profitFactor === Infinity ? 10 : metrics.profitFactor;
  return pf * Math.sqrt(metrics.wins + metrics.losses);
}

// ─── Main ──────────────────────────────────────────────────────────

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

  // Generate folds
  const folds = generateFolds(allCandles, opts.trainDays, opts.testDays, opts.stepDays);

  if (folds.length === 0) {
    console.error(`  Not enough data for train=${opts.trainDays}d + test=${opts.testDays}d windows.`);
    process.exit(1);
  }

  // Grid setup
  const gridDef = GRIDS[opts.grid];
  const useGrid = !!gridDef;
  const grid = useGrid ? expandGrid(gridDef) : null;

  // Warmup: 500 candles * 15min = ~5.2 days for 15m candles
  const warmupMs = 500 * 15 * 60 * 1000;
  // HTF warmup: 120 candles * 4h = 20 days
  const htfWarmupMs = 120 * 4 * 60 * 60 * 1000;

  // Header
  console.log('\n' + '='.repeat(90));
  console.log(`  WALK-FORWARD TEST — ${opts.symbol} (${strategy.label})`);
  console.log('='.repeat(90));
  console.log(`  Data:       ${opts.csv}`);
  console.log(`  HTF:        ${opts.htf || 'none'}`);
  console.log(`  Train:      ${opts.trainDays}d | Test: ${opts.testDays}d | Step: ${opts.stepDays}d`);
  console.log(`  Folds:      ${folds.length}`);
  console.log(`  Grid:       ${opts.grid} (${useGrid ? grid.length + ' combos' : 'strategy defaults only'})`);
  console.log('='.repeat(90));

  const foldResults = [];
  const allOosSignals = [];
  const startTime = Date.now();

  for (let fi = 0; fi < folds.length; fi++) {
    const fold = folds[fi];
    const trainLabel = `${fmtDate(fold.trainStart)} → ${fmtDate(fold.trainEnd)}`;
    const testLabel = `${fmtDate(fold.testStart)} → ${fmtDate(fold.testEnd)}`;

    process.stdout.write(`\n  Fold ${fi + 1}/${folds.length}: train ${trainLabel} | test ${testLabel}`);

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

    // Get strategy threshold
    const sp = strategy.tradeParams || {};
    const threshold = sp.threshold || config.scoring.confluenceThreshold;
    const baseOpts = { _quiet: true, threshold, verbose: false };

    let bestParams, trainMetrics;

    if (useGrid) {
      // ── Optimization: generate signals ONCE, then sweep simulateOutcomes ──
      // Signals only depend on threshold (not risk/TP params)
      const signals = backtestSymbol(opts.symbol, opts.interval, strategy, baseOpts, trainCandles, trainRegime);

      if (signals.length < 3) {
        process.stdout.write(` — skipped (${signals.length} train signals)`);
        foldResults.push({ fold: fi + 1, trainLabel, testLabel, skipped: true, reason: 'too few train signals' });
        continue;
      }

      // Sweep outcome simulation across param grid
      let bestScore = -Infinity;
      bestParams = null;
      trainMetrics = null;

      for (const params of grid) {
        const outcomes = simulateOutcomes(trainCandles, signals, params);
        const metrics = computeMetrics(outcomes);
        const score = rankScore(metrics);

        if (score > bestScore) {
          bestScore = score;
          bestParams = params;
          trainMetrics = metrics;
        }
      }
    } else {
      // No grid — use strategy defaults
      const symParams = (strategy.symbolParams || {})[opts.symbol] || {};
      bestParams = {
        riskPct: symParams.riskPct || sp.riskPct || 1.0,
        tp1RR: symParams.tp1RR || sp.tp1RR || 1.5,
        tp2RR: symParams.tp2RR != null ? symParams.tp2RR : (sp.tp2RR != null ? sp.tp2RR : 2.5),
        maxBars: symParams.maxBars || sp.maxBars || 48,
      };
      const signals = backtestSymbol(opts.symbol, opts.interval, strategy, baseOpts, trainCandles, trainRegime);
      const outcomes = simulateOutcomes(trainCandles, signals, bestParams);
      trainMetrics = computeMetrics(outcomes);
    }

    // ── Test on OOS data with best params ──
    const testSignals = backtestSymbol(opts.symbol, opts.interval, strategy, baseOpts, testCandles, testRegime);
    const testOutcomes = simulateOutcomes(testCandles, testSignals, bestParams);
    const testMetrics = computeMetrics(testOutcomes);

    // Collect OOS signals
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
      trainMetrics,
      testMetrics,
      overfitRatio,
      skipped: false,
    });

    const tPF = trainMetrics.profitFactor === Infinity ? '∞' : trainMetrics.profitFactor.toFixed(2);
    const oPF = testMetrics.profitFactor === Infinity ? '∞' : testMetrics.profitFactor.toFixed(2);
    process.stdout.write(`\n    Train: ${trainMetrics.total} sig, ${trainMetrics.winRate.toFixed(0)}% WR, PF=${tPF}, ${trainMetrics.totalPnl.toFixed(1)}R`);
    process.stdout.write(`\n    Test:  ${testMetrics.total} sig, ${testMetrics.winRate.toFixed(0)}% WR, PF=${oPF}, ${testMetrics.totalPnl.toFixed(1)}R`);
    process.stdout.write(`\n    Params: risk=${bestParams.riskPct}% tp1=${bestParams.tp1RR}R tp2=${bestParams.tp2RR}R mb=${bestParams.maxBars}`);
    if (overfitRatio != null) process.stdout.write(` | Overfit: ${overfitRatio.toFixed(2)}x`);
  }

  // ─── Aggregate Results ────────────────────────────────────────

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const activeFolds = foldResults.filter(f => !f.skipped);

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

  if (allOosSignals.length === 0) {
    console.log('\n  No OOS signals generated across any fold.');
  } else {
    const oos = computeMetrics(allOosSignals);

    console.log(`\n  Total OOS Signals:  ${oos.total}`);
    console.log(`  OOS Wins:           ${oos.wins} (TP1: ${oos.tp1}, TP2: ${oos.tp2})`);
    console.log(`  OOS Losses:         ${oos.losses}`);
    console.log(`  OOS Expired:        ${oos.expired}`);
    console.log(`  OOS Win Rate:       ${oos.winRate.toFixed(1)}%`);
    console.log(`  OOS Total R:        ${oos.totalPnl.toFixed(1)}R`);
    console.log(`  OOS Avg R/Signal:   ${oos.avgPnl.toFixed(3)}R`);
    console.log(`  OOS Profit Factor:  ${oos.profitFactor === Infinity ? '∞' : oos.profitFactor.toFixed(2)}`);
    console.log(`  OOS Max Consec L:   ${oos.maxConsecLoss}`);

    // Avg overfit ratio
    const ofRatios = activeFolds.filter(f => f.overfitRatio != null).map(f => f.overfitRatio);
    if (ofRatios.length > 0) {
      const avgOF = ofRatios.reduce((a, b) => a + b, 0) / ofRatios.length;
      console.log(`\n  Avg Overfit Ratio:  ${avgOF.toFixed(2)}x ${avgOF < 1.5 ? '(good)' : avgOF < 2.5 ? '(moderate)' : '(high — possible overfitting)'}`);
    }

    // Parameter stability
    if (activeFolds.length >= 3 && activeFolds[0].bestParams) {
      const paramArrays = { riskPct: [], tp1RR: [], tp2RR: [], maxBars: [] };
      for (const f of activeFolds) {
        for (const key of Object.keys(paramArrays)) {
          paramArrays[key].push(f.bestParams[key]);
        }
      }
      const stability = {};
      for (const [key, vals] of Object.entries(paramArrays)) {
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
        stability[key] = { mean: mean.toFixed(2), std: Math.sqrt(variance).toFixed(2) };
      }
      console.log(`\n  Parameter Stability (mean ± σ):`);
      console.log(`    risk:    ${stability.riskPct.mean}% ± ${stability.riskPct.std}`);
      console.log(`    tp1:     ${stability.tp1RR.mean}R ± ${stability.tp1RR.std}`);
      console.log(`    tp2:     ${stability.tp2RR.mean}R ± ${stability.tp2RR.std}`);
      console.log(`    maxBars: ${stability.maxBars.mean} ± ${stability.maxBars.std}`);
    }

    // Profitable folds
    const profitableFolds = activeFolds.filter(f => f.testMetrics.totalPnl > 0).length;
    console.log(`\n  Profitable Folds:   ${profitableFolds}/${activeFolds.length} (${(profitableFolds / activeFolds.length * 100).toFixed(0)}%)`);
  }

  console.log(`\n  Elapsed: ${elapsed}s | Folds: ${folds.length} (${activeFolds.length} active)`);
  console.log('='.repeat(90) + '\n');
}

// ─── Helpers ──────────────────────────────────────────────────────

function fmtDate(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

main();
