#!/usr/bin/env node
/**
 * Seed the forward-test tracker with realistic poll data for demo recording.
 *
 * Usage:
 *   node scripts/seed-forward-test.js            # seed 30 cycles over last 2h
 *   node scripts/seed-forward-test.js --cycles 60 # seed 60 cycles
 *   node scripts/seed-forward-test.js --clear     # wipe poll_scores first
 *
 * The last cycle includes a BTC A+ signal — perfect for a screen recording.
 */

const path = require('path');

// Load config so we hit the same DB
process.chdir(path.resolve(__dirname, '..'));
const config = require('../src/config');
const Database = require('better-sqlite3');
const fs = require('fs');

const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

// ── CLI args ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const shouldClear = args.includes('--clear');
let totalCycles = 30;
const cyclesIdx = args.indexOf('--cycles');
if (cyclesIdx !== -1 && args[cyclesIdx + 1]) {
  totalCycles = parseInt(args[cyclesIdx + 1], 10);
}

if (shouldClear) {
  db.prepare('DELETE FROM poll_scores').run();
  console.log('Cleared all existing poll_scores.');
}

// ── Helpers ────────────────────────────────────────────────────────
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const INTERVALS = ['15m', '1h'];
const DIRECTIONS = ['LONG', 'SHORT'];
const REGIMES = ['trending_up', 'trending_down', 'ranging', 'volatile'];
const INDICATORS = ['ema_cross', 'rsi_divergence', 'fvg_tap', 'volume_spike', 'macd_cross', 'structure_break', 'order_block'];
const REJECTION_REASONS = [null, null, null, 'cooldown', 'insufficient_rr', 'regime_filtered'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randBetween(min, max) { return +(min + Math.random() * (max - min)).toFixed(2); }

function randomFired(score) {
  // Higher scores fire more indicators
  const count = score >= 4 ? randInt(4, 6) : score >= 3 ? randInt(3, 4) : score >= 2 ? randInt(2, 3) : randInt(0, 2);
  const shuffled = [...INDICATORS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function gradeFromScore(score) {
  if (score >= 4.5) return 'A+';
  if (score >= 3.5) return 'B';
  return 'C';
}

// ── Generate cycles ────────────────────────────────────────────────
const now = Date.now();
const cycleIntervalMs = 60_000; // 60s between cycles
const startTime = now - (totalCycles * cycleIntervalMs);

const stmt = db.prepare(`
  INSERT INTO poll_scores (poll_id, timestamp, symbol, interval, direction, score, grade, fired, regime, rejection_reason, signal_generated)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertAll = db.transaction((rows) => {
  for (const r of rows) {
    stmt.run(r.pollId, r.timestamp, r.symbol, r.interval, r.direction, r.score, r.grade, r.fired, r.regime, r.rejectionReason, r.signalGenerated);
  }
});

const allRows = [];
let pollCounter = 1000;

for (let i = 0; i < totalCycles; i++) {
  const cycleTime = new Date(startTime + i * cycleIntervalMs).toISOString();
  const pollId = `poll_${pollCounter++}_${Date.now()}`;
  const isLastCycle = i === totalCycles - 1;
  const isSecondToLast = i === totalCycles - 2;

  for (const symbol of SYMBOLS) {
    for (const tf of INTERVALS) {
      const direction = pick(DIRECTIONS);
      const regime = pick(REGIMES);
      let score, rejectionReason, signalGenerated;

      if (isLastCycle && symbol === 'BTCUSDT' && tf === '1h') {
        // ★ The money shot: BTC 1h A+ signal fires
        score = randBetween(4.7, 5.0);
        rejectionReason = null;
        signalGenerated = 1;
      } else if (isSecondToLast && symbol === 'BTCUSDT' && tf === '1h') {
        // Build tension: BTC was close last cycle but got rejected
        score = randBetween(4.0, 4.4);
        rejectionReason = 'cooldown';
        signalGenerated = 0;
      } else if (isLastCycle && symbol === 'ETHUSDT' && tf === '15m') {
        // ETH also scores well but not quite A+
        score = randBetween(3.5, 4.2);
        rejectionReason = null;
        signalGenerated = 0;
      } else {
        // Normal distribution: mostly low, occasionally mid, rarely high
        const roll = Math.random();
        if (roll < 0.50) score = randBetween(0.5, 1.5);
        else if (roll < 0.75) score = randBetween(1.5, 2.5);
        else if (roll < 0.90) score = randBetween(2.5, 3.5);
        else if (roll < 0.97) score = randBetween(3.5, 4.2);
        else score = randBetween(4.3, 4.8);

        rejectionReason = score >= 3.5 ? pick(REJECTION_REASONS) : null;
        signalGenerated = (score >= 4.5 && !rejectionReason) ? 1 : 0;
      }

      const grade = gradeFromScore(score);
      const fired = randomFired(score);

      allRows.push({
        pollId,
        timestamp: cycleTime,
        symbol,
        interval: tf,
        direction: isLastCycle && symbol === 'BTCUSDT' ? 'LONG' : direction,
        score,
        grade,
        fired: JSON.stringify(fired),
        regime: isLastCycle && symbol === 'BTCUSDT' ? 'trending_up' : regime,
        rejectionReason,
        signalGenerated,
      });
    }
  }
}

insertAll(allRows);

// ── Summary ────────────────────────────────────────────────────────
const totalRows = allRows.length;
const aPlusCount = allRows.filter(r => r.grade === 'A+').length;
const signalCount = allRows.filter(r => r.signalGenerated === 1).length;
const lastAPlusRow = allRows.filter(r => r.grade === 'A+').pop();

console.log(`\nSeeded ${totalCycles} poll cycles (${totalRows} total rows)`);
console.log(`  A+ setups: ${aPlusCount}`);
console.log(`  Signals fired: ${signalCount}`);
console.log(`  Last cycle highlight: ${lastAPlusRow.symbol} ${lastAPlusRow.interval} ${lastAPlusRow.direction} — score ${lastAPlusRow.score} [${lastAPlusRow.grade}] → SIGNAL`);
console.log(`\nOpen your Forward Test page and you should see data immediately.`);

db.close();
