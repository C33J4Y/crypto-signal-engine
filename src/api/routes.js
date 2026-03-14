const express = require('express');
const { listSignals, getSignal } = require('./controllers/signalController');
const { getDashboard } = require('./controllers/dashboardController');
const { getCandles } = require('./controllers/candleController');
const { streamCandles } = require('./controllers/streamController');
const { getWebhooks, upsertWebhook } = require('./controllers/configController');
const { getPerformance } = require('./controllers/performanceController');
const { getForwardTestScores, getForwardTestStats, getForwardTestTimeline } = require('./controllers/forwardTestController');

const router = express.Router();

// Signals
router.get('/signals', listSignals);
router.get('/signals/:id', getSignal);

// Candles
router.get('/candles/:symbol/:interval', getCandles);

// Real-time stream (SSE)
router.get('/stream/candles/:symbol/:interval', streamCandles);

// Dashboard
router.get('/dashboard', getDashboard);

// Performance
router.get('/performance', getPerformance);

// Forward Test
router.get('/forward-test/scores', getForwardTestScores);
router.get('/forward-test/stats', getForwardTestStats);
router.get('/forward-test/timeline', getForwardTestTimeline);

// Config
router.get('/config/webhooks', getWebhooks);
router.post('/config/webhooks', upsertWebhook);

module.exports = router;
