/**
 * Export live data from SQLite DB to CSV format for backtesting.
 */

const fs = require('fs');
const path = require('path');
const db = require('../db/database');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

/**
 * Export candles from the DB to a CSV file compatible with loadCsvCandles.
 * @param {string} symbol - e.g. 'BTCUSDT'
 * @param {string} interval - e.g. '15m'
 * @returns {string} path to the written CSV file
 */
function exportCandles(symbol, interval) {
  db.runMigrations();

  const candles = db.getCandles(symbol, interval, 100000);

  if (candles.length === 0) {
    throw new Error(`No candles found for ${symbol}/${interval}`);
  }

  const header = 'open_time,open,high,low,close,volume,quote_volume,num_trades,close_time';
  const rows = candles.map(c =>
    `${c.open_time},${c.open},${c.high},${c.low},${c.close},${c.volume},${c.quote_volume || 0},${c.num_trades || 0},${c.close_time || c.open_time + 60000}`
  );

  const csv = [header, ...rows].join('\n');
  const filePath = path.join(DATA_DIR, `live_${symbol}_${interval}.csv`);
  fs.writeFileSync(filePath, csv, 'utf-8');

  return filePath;
}

/**
 * Get live signal outcomes from the DB for cross-referencing.
 * @param {string} [symbol] - filter by symbol (optional)
 * @returns {Array} signals with outcome data
 */
function getSignalOutcomes(symbol) {
  db.runMigrations();

  const filters = {};
  if (symbol) filters.symbol = symbol;
  filters.limit = 10000;

  const signals = db.getSignals(filters);

  return signals
    .filter(s => s.status !== 'active')
    .map(s => ({
      id: s.id,
      timestamp: s.timestamp,
      symbol: s.symbol,
      interval: s.interval,
      direction: s.direction,
      grade: s.grade,
      confluenceScore: s.confluence_score,
      entry: s.entry,
      stopLoss: s.stop_loss,
      tp1: s.tp1,
      tp2: s.tp2,
      tp3: s.tp3,
      status: s.status,
      outcomePnl: s.outcome_pnl,
    }));
}

/**
 * Get candle date range from DB.
 * @param {string} symbol
 * @param {string} interval
 * @returns {{ count: number, earliest: string, latest: string }}
 */
function getCandleRange(symbol, interval) {
  const candles = db.getCandles(symbol, interval, 100000);
  if (candles.length === 0) return { count: 0, earliest: null, latest: null };

  return {
    count: candles.length,
    earliest: new Date(candles[0].open_time).toISOString(),
    latest: new Date(candles[candles.length - 1].open_time).toISOString(),
  };
}

module.exports = { exportCandles, getSignalOutcomes, getCandleRange };
