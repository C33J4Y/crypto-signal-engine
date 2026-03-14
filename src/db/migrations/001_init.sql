-- OHLCV candle data
CREATE TABLE IF NOT EXISTS candles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  open_time INTEGER NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL,
  quote_volume REAL NOT NULL,
  num_trades INTEGER,
  close_time INTEGER NOT NULL,
  UNIQUE(symbol, interval, open_time)
);

CREATE INDEX IF NOT EXISTS idx_candles_lookup ON candles(symbol, interval, open_time DESC);

-- Active Fair Value Gaps
CREATE TABLE IF NOT EXISTS fvg_zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  direction TEXT NOT NULL,
  zone_high REAL NOT NULL,
  zone_low REAL NOT NULL,
  created_at INTEGER NOT NULL,
  filled_at INTEGER,
  UNIQUE(symbol, interval, direction, created_at)
);

-- Generated signals
CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  direction TEXT NOT NULL,
  grade TEXT NOT NULL,
  confluence_score REAL NOT NULL,
  entry REAL NOT NULL,
  stop_loss REAL NOT NULL,
  tp1 REAL,
  tp2 REAL,
  tp3 REAL,
  risk_reward TEXT NOT NULL,
  indicators_json TEXT NOT NULL,
  notes TEXT,
  status TEXT DEFAULT 'active',
  outcome_pnl REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Signal tracking / outcome
CREATE TABLE IF NOT EXISTS signal_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_id TEXT NOT NULL REFERENCES signals(id),
  event TEXT NOT NULL,
  price REAL NOT NULL,
  timestamp TEXT NOT NULL
);

-- Webhook configuration
CREATE TABLE IF NOT EXISTS webhook_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  platform TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  min_grade TEXT DEFAULT 'A+'
);
