const express = require('express');
const path = require('path');
const cron = require('node-cron');
const config = require('./config');
const db = require('./db/database');
const { pollAll } = require('./data/candleFetcher');
const { scoreAll } = require('./engine/confluenceScorer');
const { scoreAllWithStrategy } = require('./engine/strategyScorer');
const signalGenerator = require('./engine/signalGenerator');
const { trackActiveSignals } = require('./engine/signalTracker');
const { detectRegime, isDirectionAllowed } = require('./engine/regimeDetector');
const { getStrategy } = require('./strategies');
const { fetchCandles } = require('./data/candleFetcher');
const { dispatch } = require('./notifications/webhookDispatcher');
const apiRoutes = require('./api/routes');
const logger = require('./utils/logger');

// ─── Load active strategy ───────────────────────────────────────────
const activeStrategy = getStrategy(config.activeStrategy);
logger.info(`Active strategy: ${activeStrategy.label} (${activeStrategy.name})`);

const app = express();
app.use(express.json());

// CORS for frontend dev server
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─── State ─────────────────────────────────────────────────────────

let lastPollResult = null;
let pollCount = 0;
let serverStartTime = null;
let isPolling = false;
let lastSignalCheck = null;

// ─── Health Check ──────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  const candleCounts = {};
  for (const symbol of config.symbols) {
    candleCounts[symbol] = {};
    for (const tf of config.timeframes) {
      candleCounts[symbol][tf] = db.getCandleCount(symbol, tf);
    }
  }

  const activeSignals = db.getActiveSignals();

  res.json({
    status: 'ok',
    uptime: serverStartTime ? Math.floor((Date.now() - serverStartTime) / 1000) : 0,
    pollCount,
    lastPoll: lastPollResult,
    lastSignalCheck,
    isPolling,
    activeSignals: activeSignals.length,
    config: {
      symbols: config.symbols,
      timeframes: config.timeframes,
      pollIntervalSeconds: config.pollIntervalSeconds,
      confluenceThreshold: config.scoring.confluenceThreshold,
      strategy: activeStrategy.label,
    },
    candleCounts,
  });
});

// ─── Poll Trigger (manual) ─────────────────────────────────────────

app.post('/api/poll', async (req, res) => {
  if (isPolling) {
    return res.status(409).json({ error: 'Poll already in progress' });
  }

  try {
    isPolling = true;
    const result = await runPollCycle();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    isPolling = false;
  }
});

// ─── API Routes ────────────────────────────────────────────────────

app.use('/api', apiRoutes);

// ─── Serve Frontend (production) ───────────────────────────────────

app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));
app.get('/{*splat}', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const indexPath = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
  const fs = require('fs');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    next();
  }
});

// ─── Poll Cycle ────────────────────────────────────────────────────

async function runPollCycle() {
  // 1. Fetch latest candle data
  const pollResult = await pollAll();
  lastPollResult = { ...pollResult, timestamp: new Date().toISOString() };
  pollCount++;

  // 2. Detect market regime per symbol using 4h candles
  const regimes = {};
  for (const symbol of config.symbols) {
    try {
      const htfCandles = await fetchCandles(symbol, config.regime.htfInterval, config.regime.htfCandleLimit);
      // Convert to DB-style format for regime detector
      const formatted = htfCandles.map(c => ({ close: c.close, open_time: c.openTime }));
      const regime = detectRegime(formatted);
      regimes[symbol] = regime;
      if (regime) {
        logger.debug(`Regime ${symbol}: ${regime.regime} (spread: ${regime.spread}%)`);
      }
    } catch (err) {
      logger.warn(`Failed to detect regime for ${symbol}`, { error: err.message });
      regimes[symbol] = null;
    }
  }

  // 3. Run scoring using active strategy
  let qualifiedSetups;
  let allScores = [];
  let regimeFiltered = 0;

  if (activeStrategy.name === 'base') {
    // Base strategy uses the original confluenceScorer + manual regime filtering
    qualifiedSetups = scoreAll();
  } else {
    // All other strategies use the strategy scorer (regime handled internally or via filter)
    const scored = scoreAllWithStrategy(activeStrategy, regimes);
    qualifiedSetups = scored.results;
    allScores = scored.allScores;
  }

  // 4. Log all scores to forward-test tracker (before signal gen so it always runs)
  const pollId = `poll_${pollCount}_${Date.now()}`;
  const pollTimestamp = new Date().toISOString();

  if (allScores.length > 0) {
    const pollScores = allScores.map(s => ({
      pollId,
      timestamp: pollTimestamp,
      symbol: s.symbol,
      interval: s.interval,
      direction: s.direction,
      score: s.score,
      grade: s.grade,
      fired: s.fired,
      regime: s.regime,
      rejectionReason: s.rejectionReason || null,
      signalGenerated: false,
    }));

    try {
      db.insertPollScoresBatch(pollScores);
    } catch (err) {
      logger.error('Failed to log poll scores', { error: err.message });
    }

    // Log top scores for visibility
    const topScores = allScores
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (topScores.length > 0) {
      logger.info(`Top scores this cycle:`, {
        scores: topScores.map(s => `${s.symbol}/${s.interval} ${s.direction} ${s.score} [${s.fired.join(',')}]`),
      });
    }
  }

  // 5. Generate signals for A+ setups (filtered by regime for base strategy)
  const newSignals = [];
  for (const { symbol, interval, setup, candles, indicators } of qualifiedSetups) {
    if (activeStrategy.name === 'base') {
      const regime = regimes[symbol];
      if (regime && !isDirectionAllowed(symbol, setup.direction, regime.regime)) {
        logger.debug(`Signal filtered by regime: ${setup.direction} ${symbol} in ${regime.regime}`, {
          spread: regime.spread,
        });
        regimeFiltered++;
        continue;
      }
    } else if (activeStrategy.useRegimeFilter) {
      const regime = regimes[symbol];
      if (regime && !isDirectionAllowed(symbol, setup.direction, regime.regime)) {
        regimeFiltered++;
        continue;
      }
    }

    try {
      const signal = signalGenerator.generate(symbol, interval, setup, candles, indicators);
      if (signal) {
        newSignals.push(signal);

        dispatch(signal).catch(err => {
          logger.error('Notification dispatch failed', { error: err.message, signalId: signal.id });
        });
      }
    } catch (err) {
      logger.error(`Signal generation failed for ${symbol}/${interval}`, { error: err.message });
    }
  }

  // 6. Track active signals for TP/SL hits
  const trackingEvents = trackActiveSignals();

  lastSignalCheck = {
    timestamp: new Date().toISOString(),
    strategy: activeStrategy.label,
    setupsEvaluated: config.symbols.length * config.timeframes.length * 2,
    qualifiedSetups: qualifiedSetups.length,
    regimeFiltered,
    regimes: Object.fromEntries(Object.entries(regimes).map(([k, v]) => [k, v?.regime || 'unknown'])),
    newSignals: newSignals.length,
    trackingEvents: trackingEvents.length,
  };

  if (newSignals.length > 0) {
    logger.info(`New signals generated: ${newSignals.length}`, {
      signals: newSignals.map(s => `${s.direction} ${s.symbol} (${s.confluenceScore})`),
    });
  }

  return { poll: lastPollResult, signalCheck: lastSignalCheck };
}

// ─── Cron Scheduler ────────────────────────────────────────────────

function startScheduler() {
  const intervalSec = config.pollIntervalSeconds;
  const cronExpr = `*/${intervalSec} * * * * *`;

  logger.info(`Starting cron scheduler: every ${intervalSec} seconds`);

  cron.schedule(cronExpr, async () => {
    if (isPolling) {
      logger.warn('Skipping poll — previous poll still running');
      return;
    }

    try {
      isPolling = true;
      await runPollCycle();
    } catch (err) {
      logger.error('Scheduled poll cycle failed', { error: err.message });
    } finally {
      isPolling = false;
    }
  });
}

// ─── Start Server ──────────────────────────────────────────────────

async function start() {
  db.runMigrations();
  logger.info('Database migrations complete');

  // Initial data fetch + scoring
  logger.info('Running initial poll cycle...');
  try {
    isPolling = true;
    await runPollCycle();
    logger.info('Initial poll cycle complete');
  } catch (err) {
    logger.error('Initial poll cycle failed — will retry on next cron tick', { error: err.message });
  } finally {
    isPolling = false;
  }

  startScheduler();

  serverStartTime = Date.now();
  app.listen(config.server.port, () => {
    logger.info(`Server running on port ${config.server.port}`);
    logger.info(`Health: http://localhost:${config.server.port}/api/health`);
    logger.info(`Dashboard API: http://localhost:${config.server.port}/api/dashboard`);
    logger.info(`Signals API: http://localhost:${config.server.port}/api/signals`);
  });
}

// ─── Graceful Shutdown ─────────────────────────────────────────────

function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down...`);
  db.close();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch(err => {
  logger.error('Fatal startup error', { error: err.message, stack: err.stack });
  process.exit(1);
});

module.exports = app;
