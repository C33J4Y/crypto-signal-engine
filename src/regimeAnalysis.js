#!/usr/bin/env node
/**
 * Analyze backtest results by market regime (trending vs ranging).
 * Uses 4h SMA50/100 crossover to classify each period.
 *
 * Usage:
 *   node src/regimeAnalysis.js --symbol BTCUSDT --csv data/BTCUSDT_15m_5y.csv --htf data/BTCUSDT_4h_5y.csv
 */

const fs = require('fs');
const config = require('./config');
const rsi = require('./indicators/rsi');
const fvg = require('./indicators/fvg');
const volumeProfile = require('./indicators/volumeProfile');
const volume = require('./indicators/volume');
const smaRibbon = require('./indicators/smaRibbon');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { symbol: null, csv: null, htf: null, threshold: 6, riskPct: 1.0, tp1RR: 1.2, tp2RR: 0, maxBars: 48 };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--symbol': opts.symbol = args[++i]; break;
      case '--csv': opts.csv = args[++i]; break;
      case '--htf': opts.htf = args[++i]; break;
      case '--threshold': opts.threshold = parseFloat(args[++i]); break;
      case '--risk': opts.riskPct = parseFloat(args[++i]); break;
      case '--tp1': opts.tp1RR = parseFloat(args[++i]); break;
      case '--tp2': opts.tp2RR = parseFloat(args[++i]); break;
      case '--max-bars': opts.maxBars = parseInt(args[++i], 10); break;
    }
  }
  return opts;
}

function loadCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.trim().split('\n');
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const candles = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',');
    const row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = vals[j]?.trim();
    candles.push({
      open_time: Number(row.open_time),
      open: parseFloat(row.open),
      high: parseFloat(row.high),
      low: parseFloat(row.low),
      close: parseFloat(row.close),
      volume: parseFloat(row.volume),
    });
  }
  return candles.sort((a, b) => a.open_time - b.open_time);
}

function computeSMA(values, period) {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

/**
 * Classify each 4h candle into a regime:
 * - trending_bull: SMA50 > SMA100, spread > 2%
 * - trending_bear: SMA50 < SMA100, spread > 2%
 * - ranging: SMA50 ≈ SMA100, spread <= 2%
 */
function classifyRegimes(htfCandles) {
  const fast = config.scoring.smaFast;
  const slow = config.scoring.smaSlow;
  const entries = [];

  for (let i = slow - 1; i < htfCandles.length; i++) {
    const closes = htfCandles.slice(0, i + 1).map(c => c.close);
    const smaFast = computeSMA(closes, fast);
    const smaSlow = computeSMA(closes, slow);
    const spread = Math.abs(smaFast - smaSlow) / smaSlow * 100;

    let regime;
    if (spread <= 1.5) {
      regime = 'ranging';
    } else if (smaFast > smaSlow) {
      regime = 'trending_bull';
    } else {
      regime = 'trending_bear';
    }

    entries.push({ open_time: htfCandles[i].open_time, regime, smaFast, smaSlow, spread });
  }

  return entries;
}

function getRegimeAt(regimeEntries, timestamp) {
  let lo = 0, hi = regimeEntries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (regimeEntries[mid].open_time <= timestamp) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi >= 0 ? regimeEntries[hi] : null;
}

function evaluateLong(rsiResult, fvgResult, vpResult, volResult, smaResult) {
  let points = 0;
  const fired = [];
  if (rsiResult.condition === 'oversold') { points += 1.5; fired.push('RSI-OS'); }
  if (rsiResult.divergence.detected && rsiResult.divergence.type === 'bullish') { points += 2.0; fired.push('RSI-Div'); }
  if (fvgResult.active && fvgResult.direction === 'bullish') { points += 2.0; fired.push('FVG'); }
  if (vpResult.points > 0) { points += 1.5; fired.push('POC'); }
  if (volResult.spike) { points += 1.0; fired.push('Vol'); }
  if (smaResult.alignment === 'bullish') {
    points += 1.5; fired.push('SMA');
    if (smaResult.pullback) { points += 0.5; fired.push('SMA-PB'); }
  }
  return { direction: 'LONG', points: Math.round(points * 10) / 10, fired };
}

function evaluateShort(rsiResult, fvgResult, vpResult, volResult, smaResult) {
  let points = 0;
  const fired = [];
  if (rsiResult.condition === 'overbought') { points += 1.5; fired.push('RSI-OB'); }
  if (rsiResult.divergence.detected && rsiResult.divergence.type === 'bearish') { points += 2.0; fired.push('RSI-Div'); }
  if (fvgResult.active && fvgResult.direction === 'bearish') { points += 2.0; fired.push('FVG'); }
  if (vpResult.points > 0) { points += 1.5; fired.push('POC'); }
  if (volResult.spike) { points += 1.0; fired.push('Vol'); }
  if (smaResult.alignment === 'bearish') {
    points += 1.5; fired.push('SMA');
    if (smaResult.pullback) { points += 0.5; fired.push('SMA-PB'); }
  }
  return { direction: 'SHORT', points: Math.round(points * 10) / 10, fired };
}

function backtestFvg(candles, activeFvgs, currentCandle) {
  if (candles.length >= 3) {
    for (let i = candles.length - 5; i < candles.length; i++) {
      if (i < 2) continue;
      const c1 = candles[i - 2], c3 = candles[i];
      if (c1.high < c3.low) {
        const key = `bull_${c1.open_time}`;
        if (!activeFvgs.find(f => f.key === key)) activeFvgs.push({ key, direction: 'bullish', zoneHigh: c3.low, zoneLow: c1.high });
      }
      if (c1.low > c3.high) {
        const key = `bear_${c1.open_time}`;
        if (!activeFvgs.find(f => f.key === key)) activeFvgs.push({ key, direction: 'bearish', zoneHigh: c1.low, zoneLow: c3.high });
      }
    }
  }
  for (let j = activeFvgs.length - 1; j >= 0; j--) {
    const z = activeFvgs[j];
    if (z.direction === 'bullish' && currentCandle.low <= z.zoneLow) activeFvgs.splice(j, 1);
    else if (z.direction === 'bearish' && currentCandle.high >= z.zoneHigh) activeFvgs.splice(j, 1);
  }
  const price = currentCandle.close;
  for (const z of activeFvgs) {
    if (price >= z.zoneLow && price <= z.zoneHigh) return { active: true, direction: z.direction, zoneHigh: z.zoneHigh, zoneLow: z.zoneLow, points: 2.0 };
  }
  return { active: false, direction: null, zoneHigh: null, zoneLow: null, points: 0 };
}

function simulateOutcome(sorted, sig, startIdx, opts) {
  const entryPrice = sig.price;
  const risk = entryPrice * (opts.riskPct / 100);
  const isLong = sig.direction === 'LONG';
  const sl = isLong ? entryPrice - risk : entryPrice + risk;
  const tp1 = isLong ? entryPrice + risk * opts.tp1RR : entryPrice - risk * opts.tp1RR;
  const tp2 = opts.tp2RR > 0 ? (isLong ? entryPrice + risk * opts.tp2RR : entryPrice - risk * opts.tp2RR) : null;

  for (let k = startIdx + 1; k < Math.min(startIdx + opts.maxBars, sorted.length); k++) {
    const c = sorted[k];
    if (isLong) {
      if (c.low <= sl) return { outcome: 'stopped_out', pnl: -1.0 };
      if (tp2 && c.high >= tp2) return { outcome: 'tp2_hit', pnl: opts.tp2RR };
      if (c.high >= tp1) return { outcome: 'tp1_hit', pnl: opts.tp1RR };
    } else {
      if (c.high >= sl) return { outcome: 'stopped_out', pnl: -1.0 };
      if (tp2 && c.low <= tp2) return { outcome: 'tp2_hit', pnl: opts.tp2RR };
      if (c.low <= tp1) return { outcome: 'tp1_hit', pnl: opts.tp1RR };
    }
  }
  return { outcome: 'expired', pnl: 0 };
}

function main() {
  const opts = parseArgs();
  if (!opts.symbol || !opts.csv || !opts.htf) {
    console.error('Usage: node src/regimeAnalysis.js --symbol BTCUSDT --csv <15m.csv> --htf <4h.csv>');
    process.exit(1);
  }

  const candles = loadCsv(opts.csv);
  const htfCandles = loadCsv(opts.htf);
  const regimeEntries = classifyRegimes(htfCandles);

  console.log(`Loaded ${candles.length} candles (15m), ${htfCandles.length} candles (4h)`);
  console.log(`Regime data from ${new Date(regimeEntries[0].open_time).toISOString().slice(0,10)} to ${new Date(regimeEntries[regimeEntries.length-1].open_time).toISOString().slice(0,10)}`);

  // Count regime distribution
  const regimeCounts = { trending_bull: 0, trending_bear: 0, ranging: 0 };
  for (const r of regimeEntries) regimeCounts[r.regime]++;
  const total = regimeEntries.length;
  console.log(`\nRegime distribution (4h candles):`);
  console.log(`  Trending Bull: ${regimeCounts.trending_bull} (${(regimeCounts.trending_bull/total*100).toFixed(1)}%)`);
  console.log(`  Trending Bear: ${regimeCounts.trending_bear} (${(regimeCounts.trending_bear/total*100).toFixed(1)}%)`);
  console.log(`  Ranging:       ${regimeCounts.ranging} (${(regimeCounts.ranging/total*100).toFixed(1)}%)`);

  // Run backtest and tag each signal with its regime
  const activeFvgs = [];
  const startIdx = 200;
  const results = { trending_bull: [], trending_bear: [], ranging: [] };

  for (let i = startIdx; i < candles.length; i++) {
    const window = candles.slice(Math.max(0, i - 499), i + 1);
    const cur = window[window.length - 1];

    const rsiResult = rsi.analyze(window);
    const vpResult = volumeProfile.analyze(window);
    const volResult = volume.analyze(window);
    const smaResult = smaRibbon.analyze(window);
    const fvgResult = backtestFvg(window, activeFvgs, cur);

    const longScore = evaluateLong(rsiResult, fvgResult, vpResult, volResult, smaResult);
    const shortScore = evaluateShort(rsiResult, fvgResult, vpResult, volResult, smaResult);
    const best = longScore.points >= shortScore.points ? longScore : shortScore;

    if (best.points >= opts.threshold) {
      const regime = getRegimeAt(regimeEntries, cur.open_time);
      if (!regime) continue;

      const sig = { direction: best.direction, price: cur.close, time: cur.open_time, fired: best.fired, score: best.points };
      const outcome = simulateOutcome(candles, sig, i, opts);

      results[regime.regime].push({
        ...sig,
        ...outcome,
        regime: regime.regime,
        aligned: (sig.direction === 'LONG' && regime.regime === 'trending_bull') ||
                 (sig.direction === 'SHORT' && regime.regime === 'trending_bear'),
        counter: (sig.direction === 'LONG' && regime.regime === 'trending_bear') ||
                 (sig.direction === 'SHORT' && regime.regime === 'trending_bull'),
      });
    }
  }

  // Print results by regime
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  RESULTS BY REGIME — ${opts.symbol}`);
  console.log(`${'='.repeat(70)}`);

  for (const regime of ['trending_bull', 'trending_bear', 'ranging']) {
    const sigs = results[regime];
    if (sigs.length === 0) { console.log(`\n  ${regime}: No signals`); continue; }

    const wins = sigs.filter(s => s.outcome === 'tp1_hit' || s.outcome === 'tp2_hit');
    const losses = sigs.filter(s => s.outcome === 'stopped_out');
    const decided = wins.length + losses.length;
    const wr = decided > 0 ? (wins.length / decided * 100).toFixed(1) : '-';
    const pnl = sigs.reduce((s, x) => s + x.pnl, 0);

    console.log(`\n  ${regime.toUpperCase()}:`);
    console.log(`    Signals: ${sigs.length} | W: ${wins.length} | L: ${losses.length} | Exp: ${sigs.length - decided} | WR: ${wr}% | PnL: ${pnl.toFixed(1)}R`);

    // Aligned vs counter-trend
    const aligned = sigs.filter(s => s.aligned);
    const counter = sigs.filter(s => s.counter);
    const neutral = sigs.filter(s => !s.aligned && !s.counter);

    if (aligned.length > 0) {
      const aw = aligned.filter(s => s.outcome === 'tp1_hit' || s.outcome === 'tp2_hit').length;
      const al = aligned.filter(s => s.outcome === 'stopped_out').length;
      const ad = aw + al;
      const awr = ad > 0 ? (aw / ad * 100).toFixed(1) : '-';
      const apnl = aligned.reduce((s, x) => s + x.pnl, 0);
      console.log(`      With-trend:    ${aligned.length} sigs | WR: ${awr}% | PnL: ${apnl.toFixed(1)}R`);
    }
    if (counter.length > 0) {
      const cw = counter.filter(s => s.outcome === 'tp1_hit' || s.outcome === 'tp2_hit').length;
      const cl = counter.filter(s => s.outcome === 'stopped_out').length;
      const cd = cw + cl;
      const cwr = cd > 0 ? (cw / cd * 100).toFixed(1) : '-';
      const cpnl = counter.reduce((s, x) => s + x.pnl, 0);
      console.log(`      Counter-trend: ${counter.length} sigs | WR: ${cwr}% | PnL: ${cpnl.toFixed(1)}R`);
    }
    if (neutral.length > 0) {
      const nw = neutral.filter(s => s.outcome === 'tp1_hit' || s.outcome === 'tp2_hit').length;
      const nl = neutral.filter(s => s.outcome === 'stopped_out').length;
      const nd = nw + nl;
      const nwr = nd > 0 ? (nw / nd * 100).toFixed(1) : '-';
      const npnl = neutral.reduce((s, x) => s + x.pnl, 0);
      console.log(`      Neutral:       ${neutral.length} sigs | WR: ${nwr}% | PnL: ${npnl.toFixed(1)}R`);
    }
  }

  // Summary: what if we only trade aligned + ranging?
  const allSigs = [...results.trending_bull, ...results.trending_bear, ...results.ranging];
  const aligned = allSigs.filter(s => s.aligned);
  const ranging = allSigs.filter(s => s.regime === 'ranging');
  const filtered = [...aligned, ...ranging];

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  REGIME-FILTERED STRATEGY (with-trend + ranging only)`);
  console.log(`${'='.repeat(70)}`);
  const fw = filtered.filter(s => s.outcome === 'tp1_hit' || s.outcome === 'tp2_hit').length;
  const fl = filtered.filter(s => s.outcome === 'stopped_out').length;
  const fd = fw + fl;
  const fwr = fd > 0 ? (fw / fd * 100).toFixed(1) : '-';
  const fpnl = filtered.reduce((s, x) => s + x.pnl, 0);
  console.log(`  Signals: ${filtered.length}/${allSigs.length} (${(filtered.length/allSigs.length*100).toFixed(0)}% kept)`);
  console.log(`  Win Rate: ${fwr}%`);
  console.log(`  PnL: ${fpnl.toFixed(1)}R`);
  console.log(`  Avg R: ${filtered.length > 0 ? (fpnl/filtered.length).toFixed(2) : 0}R`);

  // Counter-trend stats (what we'd be dropping)
  const counter = allSigs.filter(s => s.counter);
  const cpnl = counter.reduce((s, x) => s + x.pnl, 0);
  console.log(`\n  Dropped (counter-trend): ${counter.length} sigs | PnL: ${cpnl.toFixed(1)}R`);
  console.log(`${'='.repeat(70)}`);
}

main();
