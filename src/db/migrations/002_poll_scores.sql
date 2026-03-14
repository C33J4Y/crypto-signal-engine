-- Forward-test tracker: log every scoring result from every poll cycle
CREATE TABLE IF NOT EXISTS poll_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id TEXT NOT NULL,           -- groups all scores from one poll cycle
  timestamp TEXT NOT NULL,
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  direction TEXT NOT NULL,         -- LONG or SHORT
  score REAL NOT NULL,
  grade TEXT,                      -- A+, B, C
  fired TEXT,                      -- JSON array of indicators that fired
  regime TEXT,                     -- trending_bull, trending_bear, ranging, unknown
  rejection_reason TEXT,           -- null if qualified, else: 'below_threshold', 'cooldown', 'insufficient_rr', 'regime_filtered'
  signal_generated INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_poll_scores_poll_id ON poll_scores(poll_id);
CREATE INDEX IF NOT EXISTS idx_poll_scores_symbol ON poll_scores(symbol, interval);
CREATE INDEX IF NOT EXISTS idx_poll_scores_timestamp ON poll_scores(timestamp);
CREATE INDEX IF NOT EXISTS idx_poll_scores_score ON poll_scores(score DESC);
