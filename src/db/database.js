const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config');

let db = null;

function getDb() {
  if (db) return db;

  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  logger.info('Database connected', { path: config.dbPath });
  return db;
}

function runMigrations() {
  const database = getDb();
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    database.exec(sql);
    logger.info(`Migration applied: ${file}`);
  }
}

function close() {
  if (db) {
    db.close();
    db = null;
    logger.info('Database connection closed');
  }
}

// ─── Candle Operations ─────────────────────────────────────────────

const upsertCandleSQL = `
  INSERT INTO candles (symbol, interval, open_time, open, high, low, close, volume, quote_volume, num_trades, close_time)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(symbol, interval, open_time) DO UPDATE SET
    high = excluded.high,
    low = excluded.low,
    close = excluded.close,
    volume = excluded.volume,
    quote_volume = excluded.quote_volume,
    num_trades = excluded.num_trades,
    close_time = excluded.close_time
`;

function upsertCandles(symbol, interval, candles) {
  const database = getDb();
  const stmt = database.prepare(upsertCandleSQL);

  const insertMany = database.transaction((rows) => {
    for (const row of rows) {
      stmt.run(
        symbol,
        interval,
        row.openTime,
        row.open,
        row.high,
        row.low,
        row.close,
        row.volume,
        row.quoteVolume,
        row.numTrades,
        row.closeTime
      );
    }
  });

  insertMany(candles);
  return candles.length;
}

function getCandles(symbol, interval, limit = 500) {
  const database = getDb();
  const rows = database.prepare(`
    SELECT * FROM candles
    WHERE symbol = ? AND interval = ?
    ORDER BY open_time DESC
    LIMIT ?
  `).all(symbol, interval, limit);

  return rows.reverse(); // Return in chronological order
}

function getCandleCount(symbol, interval) {
  const database = getDb();
  const row = database.prepare(`
    SELECT COUNT(*) as count FROM candles
    WHERE symbol = ? AND interval = ?
  `).get(symbol, interval);
  return row.count;
}

// ─── FVG Operations ────────────────────────────────────────────────

function upsertFvgZone(zone) {
  const database = getDb();
  database.prepare(`
    INSERT INTO fvg_zones (symbol, interval, direction, zone_high, zone_low, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol, interval, direction, created_at) DO NOTHING
  `).run(zone.symbol, zone.interval, zone.direction, zone.zoneHigh, zone.zoneLow, zone.createdAt);
}

function getActiveFvgZones(symbol, interval) {
  const database = getDb();
  return database.prepare(`
    SELECT * FROM fvg_zones
    WHERE symbol = ? AND interval = ? AND filled_at IS NULL
    ORDER BY created_at DESC
  `).all(symbol, interval);
}

function markFvgFilled(id, filledAt) {
  const database = getDb();
  database.prepare(`UPDATE fvg_zones SET filled_at = ? WHERE id = ?`).run(filledAt, id);
}

// ─── Signal Operations ─────────────────────────────────────────────

function insertSignal(signal) {
  const database = getDb();
  database.prepare(`
    INSERT INTO signals (id, timestamp, symbol, interval, direction, grade, confluence_score,
      entry, stop_loss, tp1, tp2, tp3, risk_reward, indicators_json, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    signal.id, signal.timestamp, signal.symbol, signal.interval, signal.direction,
    signal.grade, signal.confluenceScore, signal.entry, signal.stopLoss,
    signal.tp1, signal.tp2, signal.tp3, signal.riskReward,
    JSON.stringify(signal.indicators), signal.notes
  );
}

function getSignals(filters = {}) {
  const database = getDb();
  let sql = 'SELECT * FROM signals WHERE 1=1';
  const params = [];

  if (filters.symbol) { sql += ' AND symbol = ?'; params.push(filters.symbol); }
  if (filters.interval) { sql += ' AND interval = ?'; params.push(filters.interval); }
  if (filters.grade) { sql += ' AND grade = ?'; params.push(filters.grade); }
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  if (filters.direction) { sql += ' AND direction = ?'; params.push(filters.direction); }

  sql += ' ORDER BY created_at DESC';
  if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }

  return database.prepare(sql).all(...params);
}

function getSignalById(id) {
  const database = getDb();
  return database.prepare('SELECT * FROM signals WHERE id = ?').get(id);
}

function updateSignalStatus(id, status, outcomePnl = null) {
  const database = getDb();
  database.prepare(`
    UPDATE signals SET status = ?, outcome_pnl = COALESCE(?, outcome_pnl) WHERE id = ?
  `).run(status, outcomePnl, id);
}

function getActiveSignals() {
  const database = getDb();
  return database.prepare("SELECT * FROM signals WHERE status = 'active'").all();
}

function getRecentSignal(symbol, interval, direction, candlesBack) {
  const database = getDb();
  return database.prepare(`
    SELECT * FROM signals
    WHERE symbol = ? AND interval = ? AND direction = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(symbol, interval, direction);
}

// ─── Signal Tracking ───────────────────────────────────────────────

function insertTrackingEvent(signalId, event, price, timestamp) {
  const database = getDb();
  database.prepare(`
    INSERT INTO signal_tracking (signal_id, event, price, timestamp)
    VALUES (?, ?, ?, ?)
  `).run(signalId, event, price, timestamp);
}

// ─── Webhook Config ────────────────────────────────────────────────

function getWebhookConfigs() {
  const database = getDb();
  return database.prepare("SELECT * FROM webhook_config WHERE enabled = 1").all();
}

function upsertWebhook(webhook) {
  const database = getDb();
  if (webhook.id) {
    database.prepare(`
      UPDATE webhook_config SET name = ?, url = ?, platform = ?, enabled = ?, min_grade = ?
      WHERE id = ?
    `).run(webhook.name, webhook.url, webhook.platform, webhook.enabled ? 1 : 0, webhook.minGrade || 'A+', webhook.id);
  } else {
    database.prepare(`
      INSERT INTO webhook_config (name, url, platform, enabled, min_grade)
      VALUES (?, ?, ?, ?, ?)
    `).run(webhook.name, webhook.url, webhook.platform, webhook.enabled ? 1 : 0, webhook.minGrade || 'A+');
  }
}

// ─── Poll Scores (Forward Test Tracker) ──────────────────────────

function insertPollScore(score) {
  const database = getDb();
  database.prepare(`
    INSERT INTO poll_scores (poll_id, timestamp, symbol, interval, direction, score, grade, fired, regime, rejection_reason, signal_generated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    score.pollId, score.timestamp, score.symbol, score.interval,
    score.direction, score.score, score.grade, JSON.stringify(score.fired),
    score.regime, score.rejectionReason, score.signalGenerated ? 1 : 0
  );
}

function insertPollScoresBatch(scores) {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO poll_scores (poll_id, timestamp, symbol, interval, direction, score, grade, fired, regime, rejection_reason, signal_generated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = database.transaction((rows) => {
    for (const s of rows) {
      stmt.run(s.pollId, s.timestamp, s.symbol, s.interval,
        s.direction, s.score, s.grade, JSON.stringify(s.fired),
        s.regime, s.rejectionReason, s.signalGenerated ? 1 : 0);
    }
  });
  insertMany(scores);
}

function getPollScores(filters = {}) {
  const database = getDb();
  let sql = 'SELECT * FROM poll_scores WHERE 1=1';
  const params = [];

  if (filters.symbol) { sql += ' AND symbol = ?'; params.push(filters.symbol); }
  if (filters.interval) { sql += ' AND interval = ?'; params.push(filters.interval); }
  if (filters.minScore) { sql += ' AND score >= ?'; params.push(filters.minScore); }
  if (filters.since) { sql += ' AND timestamp >= ?'; params.push(filters.since); }
  if (filters.signalOnly) { sql += ' AND signal_generated = 1'; }

  sql += ' ORDER BY created_at DESC';
  const limit = filters.limit || 500;
  sql += ' LIMIT ?'; params.push(limit);

  return database.prepare(sql).all(...params);
}

function getPollScoreStats(since) {
  const database = getDb();
  const sinceClause = since ? 'AND timestamp >= ?' : '';
  const params = since ? [since] : [];

  const stats = database.prepare(`
    SELECT
      symbol, interval,
      COUNT(*) as total_polls,
      ROUND(AVG(score), 2) as avg_score,
      ROUND(MAX(score), 2) as max_score,
      SUM(CASE WHEN grade = 'A+' THEN 1 ELSE 0 END) as a_plus_count,
      SUM(CASE WHEN grade = 'B' THEN 1 ELSE 0 END) as b_count,
      SUM(CASE WHEN signal_generated = 1 THEN 1 ELSE 0 END) as signals_generated,
      SUM(CASE WHEN rejection_reason = 'cooldown' THEN 1 ELSE 0 END) as cooldown_rejections,
      SUM(CASE WHEN rejection_reason = 'insufficient_rr' THEN 1 ELSE 0 END) as rr_rejections,
      SUM(CASE WHEN rejection_reason = 'regime_filtered' THEN 1 ELSE 0 END) as regime_rejections
    FROM poll_scores
    WHERE 1=1 ${sinceClause}
    GROUP BY symbol, interval
    ORDER BY symbol, interval
  `).all(...params);

  return stats;
}

module.exports = {
  getDb,
  runMigrations,
  close,
  upsertCandles,
  getCandles,
  getCandleCount,
  upsertFvgZone,
  getActiveFvgZones,
  markFvgFilled,
  insertSignal,
  getSignals,
  getSignalById,
  updateSignalStatus,
  getActiveSignals,
  getRecentSignal,
  insertTrackingEvent,
  getWebhookConfigs,
  upsertWebhook,
  insertPollScore,
  insertPollScoresBatch,
  getPollScores,
  getPollScoreStats,
};
