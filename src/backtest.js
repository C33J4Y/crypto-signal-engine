#!/usr/bin/env node
/**
 * Backtester — Replay historical candle data through pluggable strategy modules.
 *
 * Usage:
 *   node src/backtest.js                                        # Base strategy, all symbols
 *   node src/backtest.js --strategy mean-reversion               # Run a specific strategy
 *   node src/backtest.js --compare-all --csv data.csv --symbol BTCUSDT --interval 15m
 *   node src/backtest.js --list-strategies                       # Show all available strategies
 */

const config = require('./config');
const db = require('./db/database');
const { buildRegimeLookup } = require('./engine/regimeDetector');
const { getStrategy, getAllStrategies, listStrategies } = require('./strategies');
const {
  loadCsvCandles,
  backtestSymbol,
  simulateOutcomes,
  mergeOpts,
  computeMetrics,
} = require('./engine/backtestCore');

// ─── Parse CLI args ────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    symbols: config.symbols,
    intervals: config.timeframes,
    days: null,
    threshold: null,
    verbose: false,
    csv: null,
    riskPct: null,
    tp1RR: null,
    tp2RR: null,
    maxBars: null,
    htf: null,
    strategy: null,
    compareAll: false,
    listStrategies: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--symbol': opts.symbols = [args[++i]]; break;
      case '--interval': opts.intervals = [args[++i]]; break;
      case '--days': opts.days = parseInt(args[++i], 10); break;
      case '--threshold': opts.threshold = parseFloat(args[++i]); break;
      case '--csv': opts.csv = args[++i]; break;
      case '--htf': opts.htf = args[++i]; break;
      case '--risk': opts.riskPct = parseFloat(args[++i]); break;
      case '--tp1': opts.tp1RR = parseFloat(args[++i]); break;
      case '--tp2': opts.tp2RR = parseFloat(args[++i]); break;
      case '--max-bars': opts.maxBars = parseInt(args[++i], 10); break;
      case '--strategy': opts.strategy = args[++i]; break;
      case '--compare-all': opts.compareAll = true; break;
      case '--list-strategies': opts.listStrategies = true; break;
      case '--verbose': case '-v': opts.verbose = true; break;
      case '--help': case '-h':
        printHelp();
        process.exit(0);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`
Crypto Signal Engine — Backtester

Usage: node src/backtest.js [options]

Options:
  --symbol BTCUSDT         Backtest a single symbol
  --interval 15m           Backtest a single timeframe
  --days 7                 Only test the last N days of data
  --threshold 5.0          Override confluence score threshold
  --verbose, -v            Show every candle's score breakdown
  --csv <file>             Load candle data from a CSV file (bypasses DB)
  --htf <file>             Higher-timeframe CSV for regime filter (e.g. 4h candles)
  --risk 1.0               SL risk as % of entry price
  --tp1 1.5                TP1 as R-multiple
  --tp2 2.5                TP2 as R-multiple (0 to disable)
  --max-bars 48            Max candles before signal expires

Strategy options:
  --strategy <name>        Run a specific strategy (default: base)
  --compare-all            Run ALL strategies and output comparison table
  --list-strategies        List all available strategies with descriptions
  --help, -h               Show this help

CSV format (header row required):
  open_time,open,high,low,close,volume

Examples:
  node src/backtest.js --strategy mean-reversion --csv data/BTCUSDT_15m_5y.csv --symbol BTCUSDT --interval 15m
  node src/backtest.js --compare-all --csv data/BTCUSDT_15m_5y.csv --symbol BTCUSDT --interval 15m --htf data/BTCUSDT_4h_5y.csv
  node src/backtest.js --list-strategies
`);
}

// ─── Run a single strategy ────────────────────────────────────────

function runStrategy(strategy, opts, csvCandles, regimeLookup) {
  let allSignals = [];

  for (const symbol of opts.symbols) {
    const merged = mergeOpts(opts, strategy, symbol);
    for (const interval of opts.intervals) {
      const candles = csvCandles || db.getCandles(symbol, interval, 1000);
      const signals = backtestSymbol(symbol, interval, strategy, merged, candles, regimeLookup);

      if (signals.length > 0) {
        const withOutcomes = simulateOutcomes(candles, signals, merged);
        allSignals.push(...withOutcomes);
      }
    }
  }

  return { signals: allSignals, merged: mergeOpts(opts, strategy, opts.symbols[0]) };
}

// ─── Print detailed results for a single strategy ─────────────────

function printResults(strategy, allSignals, merged) {
  console.log('\n' + '='.repeat(70));
  console.log(`  BACKTEST RESULTS — ${strategy.label.toUpperCase()}`);
  console.log('='.repeat(70));

  if (allSignals.length === 0) {
    console.log('\n  No signals generated. Try lowering --threshold or using a different strategy.');
    return;
  }

  const m = computeMetrics(allSignals);

  console.log(`\n  Total Signals: ${m.total}`);
  console.log(`  Wins:          ${m.wins} (TP1: ${m.tp1}, TP2: ${m.tp2})`);
  console.log(`  Losses:        ${m.losses}`);
  console.log(`  Expired:       ${m.expired}`);
  console.log(`  Win Rate:      ${m.winRate.toFixed(1)}%`);
  console.log(`  Total R:       ${m.totalPnl.toFixed(1)}R`);
  console.log(`  Avg R/Signal:  ${m.avgPnl.toFixed(2)}R`);
  console.log(`  Profit Factor: ${m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2)}`);
  console.log(`  Max Consec L:  ${m.maxConsecLoss}`);

  // By symbol
  console.log('\n  By Symbol:');
  const bySymbol = {};
  for (const s of allSignals) {
    if (!bySymbol[s.symbol]) bySymbol[s.symbol] = { total: 0, wins: 0, losses: 0, pnl: 0 };
    bySymbol[s.symbol].total++;
    if (s.outcome === 'tp1_hit' || s.outcome === 'tp2_hit') bySymbol[s.symbol].wins++;
    if (s.outcome === 'stopped_out') bySymbol[s.symbol].losses++;
    bySymbol[s.symbol].pnl += (s.pnl || 0);
  }
  for (const [sym, data] of Object.entries(bySymbol)) {
    const d = data.wins + data.losses;
    const wr = d > 0 ? ((data.wins / d) * 100).toFixed(0) : '-';
    console.log(`    ${sym.padEnd(10)} ${data.total} signals | ${data.wins}W ${data.losses}L | WR: ${wr}% | PnL: ${data.pnl.toFixed(1)}R`);
  }

  // By direction
  console.log('\n  By Direction:');
  const longs = allSignals.filter(s => s.direction === 'LONG');
  const shorts = allSignals.filter(s => s.direction === 'SHORT');
  const longWins = longs.filter(s => s.outcome === 'tp1_hit' || s.outcome === 'tp2_hit').length;
  const shortWins = shorts.filter(s => s.outcome === 'tp1_hit' || s.outcome === 'tp2_hit').length;
  const longD = longWins + longs.filter(s => s.outcome === 'stopped_out').length;
  const shortD = shortWins + shorts.filter(s => s.outcome === 'stopped_out').length;
  console.log(`    LONG:  ${longs.length} signals | WR: ${longD > 0 ? ((longWins / longD) * 100).toFixed(0) : '-'}%`);
  console.log(`    SHORT: ${shorts.length} signals | WR: ${shortD > 0 ? ((shortWins / shortD) * 100).toFixed(0) : '-'}%`);

  // Signal details
  if (!merged._quiet) {
    console.log('\n  Signal Details:');
    console.log('  ' + '-'.repeat(100));
    console.log(`  ${'Time'.padEnd(18)} ${'Symbol'.padEnd(10)} ${'TF'.padEnd(4)} ${'Dir'.padEnd(6)} ${'Score'.padEnd(6)} ${'Price'.padEnd(12)} ${'Indicators'.padEnd(25)} ${'Outcome'.padEnd(12)} ${'PnL'.padEnd(6)}`);
    console.log('  ' + '-'.repeat(100));

    for (const s of allSignals) {
      const time = s.time.slice(5, 16).replace('T', ' ');
      const price = typeof s.price === 'number' ? s.price.toFixed(2) : String(s.price);
      console.log(
        `  ${time.padEnd(18)} ${s.symbol.replace('USDT', '').padEnd(10)} ${s.interval.padEnd(4)} ${s.direction.padEnd(6)} ${String(s.score).padEnd(6)} $${price.padEnd(11)} ${s.indicators.join(', ').padEnd(25)} ${(s.outcome || '-').padEnd(12)} ${s.pnl != null ? s.pnl.toFixed(1) + 'R' : '-'}`
      );
    }
  }

  console.log('\n' + '='.repeat(70));
}

// ─── Comparison table ─────────────────────────────────────────────

function printComparisonTable(results) {
  console.log('\n' + '='.repeat(90));
  console.log('  STRATEGY COMPARISON');
  console.log('='.repeat(90));

  const header = `  ${'Strategy'.padEnd(28)} ${'Signals'.padStart(7)} ${'WR%'.padStart(6)} ${'TotalR'.padStart(8)} ${'AvgR'.padStart(7)} ${'PF'.padStart(6)} ${'MaxCL'.padStart(6)} ${'W'.padStart(4)} ${'L'.padStart(4)}`;
  console.log(header);
  console.log('  ' + '-'.repeat(86));

  results.sort((a, b) => b.metrics.totalPnl - a.metrics.totalPnl);

  for (const r of results) {
    const m = r.metrics;
    const pf = m.profitFactor === Infinity ? '  ∞' : m.profitFactor.toFixed(1).padStart(6);
    console.log(
      `  ${r.strategy.label.padEnd(28)} ${String(m.total).padStart(7)} ${m.winRate.toFixed(1).padStart(5)}% ${(m.totalPnl >= 0 ? '+' : '') + m.totalPnl.toFixed(1) + 'R'}${' '.repeat(Math.max(0, 7 - ((m.totalPnl >= 0 ? '+' : '') + m.totalPnl.toFixed(1) + 'R').length))} ${m.avgPnl.toFixed(2).padStart(6)}R ${pf} ${String(m.maxConsecLoss).padStart(6)} ${String(m.wins).padStart(4)} ${String(m.losses).padStart(4)}`
    );
  }

  console.log('  ' + '-'.repeat(86));
  console.log('\n  PF = Profit Factor | MaxCL = Max Consecutive Losses | W/L = Wins/Losses');
  console.log('  Sorted by Total R (best to worst)\n');
}

// ─── Main ──────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs();

  if (opts.listStrategies) {
    listStrategies();
    return;
  }

  const csvMode = !!opts.csv;
  let csvCandles = null;

  if (csvMode) {
    if (opts.symbols.length !== 1) {
      console.error('  When using --csv, you must also provide --symbol (e.g. --symbol BTCUSDT)');
      process.exit(1);
    }
    if (opts.intervals.length !== 1) {
      console.error('  When using --csv, you must also provide --interval (e.g. --interval 15m)');
      process.exit(1);
    }
    csvCandles = loadCsvCandles(opts.csv);
  } else {
    db.runMigrations();
  }

  let regimeLookup = null;
  if (opts.htf) {
    console.log(`\nLoading HTF data for regime filter...`);
    const htfCandles = loadCsvCandles(opts.htf);
    regimeLookup = buildRegimeLookup(htfCandles);
    console.log(`  Regime filter active (SMA${config.scoring.smaFast}/${config.scoring.smaSlow}, ranging threshold: ${config.regime.rangingThresholdPct}%)\n`);
  }

  // Compare All mode
  if (opts.compareAll) {
    const strategies = getAllStrategies();
    console.log('\n' + '='.repeat(70));
    console.log('  CRYPTO SIGNAL ENGINE — STRATEGY COMPARISON');
    console.log('='.repeat(70));
    console.log(`  Source:     ${csvMode ? opts.csv : 'database'}`);
    console.log(`  Symbols:    ${opts.symbols.join(', ')}`);
    console.log(`  Timeframes: ${opts.intervals.join(', ')}`);
    console.log(`  HTF Filter: ${opts.htf ? opts.htf : 'off'}`);
    console.log(`  Strategies: ${strategies.length}`);
    console.log('='.repeat(70));

    const results = [];
    for (const strategy of strategies) {
      const merged = mergeOpts(opts, strategy);
      merged._quiet = true;
      process.stdout.write(`\n  Running ${strategy.label.padEnd(28)}...`);
      const { signals } = runStrategy(strategy, opts, csvCandles, regimeLookup);
      const metrics = computeMetrics(signals);
      results.push({ strategy, metrics, merged });
      process.stdout.write(` ${signals.length} signals, ${metrics.winRate.toFixed(1)}% WR, ${metrics.totalPnl.toFixed(1)}R`);
    }

    printComparisonTable(results);
    if (!csvMode) db.close();
    return;
  }

  // Single strategy mode
  const strategy = opts.strategy ? getStrategy(opts.strategy) : getStrategy('base');
  const merged = mergeOpts(opts, strategy);

  console.log('\n' + '='.repeat(70));
  console.log('  CRYPTO SIGNAL ENGINE — BACKTEST');
  console.log('='.repeat(70));
  console.log(`  Strategy:   ${strategy.label} (${strategy.name})`);
  console.log(`  Source:     ${csvMode ? opts.csv : 'database'}`);
  console.log(`  Symbols:    ${opts.symbols.join(', ')}`);
  console.log(`  Timeframes: ${opts.intervals.join(', ')}`);
  console.log(`  Threshold:  ${merged.threshold}/10`);
  if (strategy.symbolParams && opts.symbols.length > 1) {
    console.log('  Risk/SL:    per-symbol (see below)');
    for (const sym of opts.symbols) {
      const m = mergeOpts(opts, strategy, sym);
      console.log(`    ${sym.padEnd(10)} risk=${m.riskPct}% | TP1=${m.tp1RR}R | TP2=${m.tp2RR > 0 ? m.tp2RR + 'R' : 'off'} | maxBars=${m.maxBars}`);
    }
  } else {
    console.log(`  Risk/SL:    ${merged.riskPct}% | TP1: ${merged.tp1RR}R | TP2: ${merged.tp2RR > 0 ? merged.tp2RR + 'R' : 'disabled'} | Max bars: ${merged.maxBars}`);
  }
  console.log(`  HTF Filter: ${opts.htf ? opts.htf : 'off'} | Regime: ${strategy.useRegimeFilter ? 'yes' : 'off'}`);
  console.log(`  Days:       ${opts.days || 'all available'}`);
  console.log('='.repeat(70));

  const { signals: allSignals } = runStrategy(strategy, opts, csvCandles, regimeLookup);
  printResults(strategy, allSignals, merged);

  if (!csvMode) db.close();
}

main();
