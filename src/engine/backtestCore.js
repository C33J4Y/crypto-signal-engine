/**
 * Shared backtesting engine — core functions used by backtest.js and walkForward.js.
 */

const fs = require('fs');
const config = require('../config');
const rsi = require('../indicators/rsi');
const volumeProfile = require('../indicators/volumeProfile');
const volume = require('../indicators/volume');
const smaRibbon = require('../indicators/smaRibbon');
const { isDirectionAllowed } = require('./regimeDetector');

// ─── CSV Loading ──────────────────────────────────────────────────

function loadCsvCandles(filePath, quiet) {
  if (!fs.existsSync(filePath)) {
    console.error(`  CSV file not found: ${filePath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.trim().split('\n');

  if (lines.length < 2) {
    console.error('  CSV file must have a header row and at least one data row.');
    process.exit(1);
  }

  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const required = ['open_time', 'open', 'high', 'low', 'close', 'volume'];
  for (const col of required) {
    if (!header.includes(col)) {
      console.error(`  CSV missing required column: ${col}`);
      console.error(`  Found columns: ${header.join(', ')}`);
      process.exit(1);
    }
  }

  const candles = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = line.split(',');
    const row = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]] = values[j]?.trim();
    }

    candles.push({
      open_time: Number(row.open_time),
      open: parseFloat(row.open),
      high: parseFloat(row.high),
      low: parseFloat(row.low),
      close: parseFloat(row.close),
      volume: parseFloat(row.volume),
      quote_volume: row.quote_volume ? parseFloat(row.quote_volume) : 0,
      num_trades: row.num_trades ? parseInt(row.num_trades, 10) : 0,
      close_time: row.close_time ? Number(row.close_time) : Number(row.open_time) + 60000,
    });
  }

  candles.sort((a, b) => a.open_time - b.open_time);

  if (!quiet) {
    console.log(`  Loaded ${candles.length} candles from CSV`);
    console.log(`  Range: ${new Date(candles[0].open_time).toISOString()} → ${new Date(candles[candles.length - 1].open_time).toISOString()}`);
  }

  return candles;
}

// ─── In-memory FVG detection ──────────────────────────────────────

function backtestFvg(candles, activeFvgs, currentCandle) {
  if (candles.length >= 3) {
    for (let i = candles.length - 5; i < candles.length; i++) {
      if (i < 2) continue;
      const c1 = candles[i - 2];
      const c3 = candles[i];

      if (c1.high < c3.low) {
        const key = `bull_${c1.open_time}`;
        if (!activeFvgs.find(f => f.key === key)) {
          activeFvgs.push({ key, direction: 'bullish', zoneHigh: c3.low, zoneLow: c1.high });
        }
      }
      if (c1.low > c3.high) {
        const key = `bear_${c1.open_time}`;
        if (!activeFvgs.find(f => f.key === key)) {
          activeFvgs.push({ key, direction: 'bearish', zoneHigh: c1.low, zoneLow: c3.high });
        }
      }
    }
  }

  for (let j = activeFvgs.length - 1; j >= 0; j--) {
    const z = activeFvgs[j];
    if (z.direction === 'bullish' && currentCandle.low <= z.zoneLow) {
      activeFvgs.splice(j, 1);
    } else if (z.direction === 'bearish' && currentCandle.high >= z.zoneHigh) {
      activeFvgs.splice(j, 1);
    }
  }

  const price = currentCandle.close;
  for (const z of activeFvgs) {
    if (price >= z.zoneLow && price <= z.zoneHigh) {
      return { active: true, direction: z.direction, zoneHigh: z.zoneHigh, zoneLow: z.zoneLow, points: 2.0 };
    }
  }

  return { active: false, direction: null, zoneHigh: null, zoneLow: null, points: 0 };
}

// ─── Compute indicators for a candle window ───────────────────────

function computeIndicators(window, activeFvgs, currentCandle) {
  return {
    rsi: rsi.analyze(window),
    volumeProfile: volumeProfile.analyze(window),
    volume: volume.analyze(window),
    smaRibbon: smaRibbon.analyze(window),
    fvg: backtestFvg(window, activeFvgs, currentCandle),
  };
}

// ─── Backtesting Logic ─────────────────────────────────────────────

function backtestSymbol(symbol, interval, strategy, mergedOpts, csvCandles, regimeLookup) {
  let allCandles = csvCandles;

  if (mergedOpts.days) {
    const cutoff = Date.now() - mergedOpts.days * 24 * 60 * 60 * 1000;
    allCandles = allCandles.filter(c => c.open_time >= cutoff);
  }

  if (allCandles.length < 110) {
    if (!mergedOpts._quiet) console.log(`  Skipping ${symbol}/${interval} — only ${allCandles.length} candles (need 110+)`);
    return [];
  }

  const signals = [];
  const windowSize = 200;
  const startIdx = Math.max(windowSize, 0);
  const activeFvgs = [];

  for (let i = startIdx; i < allCandles.length; i++) {
    const window = allCandles.slice(Math.max(0, i - 499), i + 1);
    const currentCandle = window[window.length - 1];

    const indicators = computeIndicators(window, activeFvgs, currentCandle);

    let currentRegime = null;
    if (regimeLookup) {
      currentRegime = regimeLookup(currentCandle.open_time);
    }

    const result = strategy.evaluate(currentCandle, indicators, { ...mergedOpts, currentRegime });

    if (!result || !result.direction || result.points < mergedOpts.threshold) continue;

    if (strategy.useRegimeFilter && currentRegime && currentRegime.regime) {
      if (!isDirectionAllowed(symbol, result.direction, currentRegime.regime)) {
        continue;
      }
    }

    if (mergedOpts.verbose && result.points >= 3.0) {
      const time = new Date(currentCandle.open_time).toISOString().slice(0, 16);
      console.log(`  [${time}] ${result.direction} ${result.points}/10 [${result.fired.join(', ')}] @ $${currentCandle.close}`);
    }

    signals.push({
      time: new Date(currentCandle.open_time).toISOString(),
      symbol,
      interval,
      direction: result.direction,
      score: result.points,
      indicators: result.fired,
      price: currentCandle.close,
      rsi: indicators.rsi.value,
    });
  }

  return signals;
}

// ─── Simulate outcomes ────────────────────────────────────────────

function simulateOutcomes(sortedCandles, signals, opts) {
  const riskPct = opts.riskPct / 100;
  const tp1RR = opts.tp1RR;
  const tp2RR = opts.tp2RR;
  const maxBars = opts.maxBars;

  return signals.map(sig => {
    const entryPrice = sig.price;
    const risk = entryPrice * riskPct;
    const isLong = sig.direction === 'LONG';

    const sl = isLong ? entryPrice - risk : entryPrice + risk;
    const tp1 = isLong ? entryPrice + risk * tp1RR : entryPrice - risk * tp1RR;
    const tp2 = tp2RR > 0 ? (isLong ? entryPrice + risk * tp2RR : entryPrice - risk * tp2RR) : null;

    const entryTime = new Date(sig.time).getTime();
    const startIdx = sortedCandles.findIndex(c => c.open_time >= entryTime);
    if (startIdx < 0) return { ...sig, outcome: 'pending', exitPrice: null };

    for (let k = startIdx + 1; k < Math.min(startIdx + maxBars, sortedCandles.length); k++) {
      const c = sortedCandles[k];
      if (isLong) {
        if (c.low <= sl) return { ...sig, outcome: 'stopped_out', exitPrice: sl, pnl: -1.0 };
        if (tp2 && c.high >= tp2) return { ...sig, outcome: 'tp2_hit', exitPrice: tp2, pnl: tp2RR };
        if (c.high >= tp1) return { ...sig, outcome: 'tp1_hit', exitPrice: tp1, pnl: tp1RR };
      } else {
        if (c.high >= sl) return { ...sig, outcome: 'stopped_out', exitPrice: sl, pnl: -1.0 };
        if (tp2 && c.low <= tp2) return { ...sig, outcome: 'tp2_hit', exitPrice: tp2, pnl: tp2RR };
        if (c.low <= tp1) return { ...sig, outcome: 'tp1_hit', exitPrice: tp1, pnl: tp1RR };
      }
    }

    return { ...sig, outcome: 'expired', exitPrice: sortedCandles[Math.min(startIdx + maxBars, sortedCandles.length - 1)]?.close, pnl: 0 };
  });
}

// ─── Merge trade params ───────────────────────────────────────────

function mergeOpts(cliOpts, strategy, symbol) {
  const sp = strategy.tradeParams || {};
  const symParams = (strategy.symbolParams && symbol) ? (strategy.symbolParams[symbol] || {}) : {};
  return {
    ...cliOpts,
    threshold: cliOpts.threshold ?? symParams.threshold ?? sp.threshold ?? config.scoring.confluenceThreshold,
    riskPct: cliOpts.riskPct ?? symParams.riskPct ?? sp.riskPct ?? 1.0,
    tp1RR: cliOpts.tp1RR ?? symParams.tp1RR ?? sp.tp1RR ?? 1.5,
    tp2RR: cliOpts.tp2RR ?? symParams.tp2RR ?? sp.tp2RR ?? 2.5,
    maxBars: cliOpts.maxBars ?? symParams.maxBars ?? sp.maxBars ?? 48,
  };
}

// ─── Compute metrics from signals ─────────────────────────────────

function computeMetrics(allSignals) {
  const wins = allSignals.filter(s => s.outcome === 'tp1_hit' || s.outcome === 'tp2_hit');
  const losses = allSignals.filter(s => s.outcome === 'stopped_out');
  const expired = allSignals.filter(s => s.outcome === 'expired');
  const decided = wins.length + losses.length;
  const winRate = decided > 0 ? (wins.length / decided) * 100 : 0;
  const totalPnl = allSignals.reduce((sum, s) => sum + (s.pnl || 0), 0);
  const avgPnl = allSignals.length > 0 ? totalPnl / allSignals.length : 0;

  const grossProfit = allSignals.filter(s => (s.pnl || 0) > 0).reduce((s, x) => s + x.pnl, 0);
  const grossLoss = Math.abs(allSignals.filter(s => (s.pnl || 0) < 0).reduce((s, x) => s + x.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  let maxConsecLoss = 0, curConsecLoss = 0;
  for (const s of allSignals) {
    if (s.outcome === 'stopped_out') { curConsecLoss++; maxConsecLoss = Math.max(maxConsecLoss, curConsecLoss); }
    else if (s.outcome === 'tp1_hit' || s.outcome === 'tp2_hit') { curConsecLoss = 0; }
  }

  return {
    total: allSignals.length,
    wins: wins.length,
    losses: losses.length,
    expired: expired.length,
    tp1: allSignals.filter(s => s.outcome === 'tp1_hit').length,
    tp2: allSignals.filter(s => s.outcome === 'tp2_hit').length,
    winRate,
    totalPnl,
    avgPnl,
    profitFactor,
    maxConsecLoss,
  };
}

module.exports = {
  loadCsvCandles,
  backtestFvg,
  computeIndicators,
  backtestSymbol,
  simulateOutcomes,
  mergeOpts,
  computeMetrics,
};
