const db = require('../db/database');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Track active signals against current price action.
 * Called on each poll cycle after candle data is updated.
 */
function trackActiveSignals() {
  const activeSignals = db.getActiveSignals();

  if (activeSignals.length === 0) return [];

  const events = [];

  for (const signal of activeSignals) {
    try {
      const candles = db.getCandles(signal.symbol, signal.interval, 5);
      if (candles.length === 0) continue;

      const latest = candles[candles.length - 1];
      const currentHigh = latest.high;
      const currentLow = latest.low;
      const now = new Date().toISOString();

      if (signal.direction === 'LONG') {
        // Check SL hit
        if (currentLow <= signal.stop_loss) {
          const event = { type: 'sl_hit', signal, price: signal.stop_loss };
          db.updateSignalStatus(signal.id, 'stopped_out', calculatePnl(signal, signal.stop_loss));
          db.insertTrackingEvent(signal.id, 'sl_hit', signal.stop_loss, now);
          events.push(event);
          logger.info(`SL HIT: ${signal.symbol} ${signal.direction}`, { id: signal.id, sl: signal.stop_loss });
          continue;
        }

        // Check TP hits (check in order: TP1 → TP2 → TP3)
        if (signal.status === 'active' && currentHigh >= signal.tp1) {
          db.updateSignalStatus(signal.id, 'tp1_hit', calculatePnl(signal, signal.tp1));
          db.insertTrackingEvent(signal.id, 'tp1_hit', signal.tp1, now);
          events.push({ type: 'tp1_hit', signal, price: signal.tp1 });
          logger.info(`TP1 HIT: ${signal.symbol}`, { id: signal.id, tp1: signal.tp1 });
        }
        if (signal.tp2 && (signal.status === 'active' || signal.status === 'tp1_hit') && currentHigh >= signal.tp2) {
          db.updateSignalStatus(signal.id, 'tp2_hit', calculatePnl(signal, signal.tp2));
          db.insertTrackingEvent(signal.id, 'tp2_hit', signal.tp2, now);
          events.push({ type: 'tp2_hit', signal, price: signal.tp2 });
          logger.info(`TP2 HIT: ${signal.symbol}`, { id: signal.id, tp2: signal.tp2 });
        }
        if (signal.tp3 && (signal.status === 'active' || signal.status === 'tp1_hit' || signal.status === 'tp2_hit') && currentHigh >= signal.tp3) {
          db.updateSignalStatus(signal.id, 'tp3_hit', calculatePnl(signal, signal.tp3));
          db.insertTrackingEvent(signal.id, 'tp3_hit', signal.tp3, now);
          events.push({ type: 'tp3_hit', signal, price: signal.tp3 });
          logger.info(`TP3 HIT: ${signal.symbol}`, { id: signal.id, tp3: signal.tp3 });
        }
      } else {
        // SHORT direction
        if (currentHigh >= signal.stop_loss) {
          db.updateSignalStatus(signal.id, 'stopped_out', calculatePnl(signal, signal.stop_loss));
          db.insertTrackingEvent(signal.id, 'sl_hit', signal.stop_loss, now);
          events.push({ type: 'sl_hit', signal, price: signal.stop_loss });
          logger.info(`SL HIT: ${signal.symbol} ${signal.direction}`, { id: signal.id, sl: signal.stop_loss });
          continue;
        }

        if (signal.tp1 && signal.status === 'active' && currentLow <= signal.tp1) {
          db.updateSignalStatus(signal.id, 'tp1_hit', calculatePnl(signal, signal.tp1));
          db.insertTrackingEvent(signal.id, 'tp1_hit', signal.tp1, now);
          events.push({ type: 'tp1_hit', signal, price: signal.tp1 });
          logger.info(`TP1 HIT: ${signal.symbol}`, { id: signal.id, tp1: signal.tp1 });
        }
        if (signal.tp2 && (signal.status === 'active' || signal.status === 'tp1_hit') && currentLow <= signal.tp2) {
          db.updateSignalStatus(signal.id, 'tp2_hit', calculatePnl(signal, signal.tp2));
          db.insertTrackingEvent(signal.id, 'tp2_hit', signal.tp2, now);
          events.push({ type: 'tp2_hit', signal, price: signal.tp2 });
          logger.info(`TP2 HIT: ${signal.symbol}`, { id: signal.id, tp2: signal.tp2 });
        }
        if (signal.tp3 && (signal.status === 'active' || signal.status === 'tp1_hit' || signal.status === 'tp2_hit') && currentLow <= signal.tp3) {
          db.updateSignalStatus(signal.id, 'tp3_hit', calculatePnl(signal, signal.tp3));
          db.insertTrackingEvent(signal.id, 'tp3_hit', signal.tp3, now);
          events.push({ type: 'tp3_hit', signal, price: signal.tp3 });
          logger.info(`TP3 HIT: ${signal.symbol}`, { id: signal.id, tp3: signal.tp3 });
        }
      }

      // Check expiry using per-symbol maxBars converted to time
      const profile = config.getSymbolProfile(signal.symbol);
      const candleDurationMs = signal.interval === '15m' ? 15 * 60 * 1000 : 60 * 60 * 1000;
      const expiryMs = profile.maxBars * candleDurationMs;
      const signalAge = Date.now() - new Date(signal.timestamp).getTime();
      if (signalAge > expiryMs && signal.status === 'active') {
        db.updateSignalStatus(signal.id, 'expired');
        db.insertTrackingEvent(signal.id, 'expired', latest.close, now);
        events.push({ type: 'expired', signal, price: latest.close });
        logger.info(`EXPIRED: ${signal.symbol}`, { id: signal.id });
      }
    } catch (err) {
      logger.error(`Tracking error for signal ${signal.id}`, { error: err.message });
    }
  }

  return events;
}

/**
 * Calculate P&L percentage for a signal.
 */
function calculatePnl(signal, exitPrice) {
  if (signal.direction === 'LONG') {
    return ((exitPrice - signal.entry) / signal.entry) * 100;
  } else {
    return ((signal.entry - exitPrice) / signal.entry) * 100;
  }
}

module.exports = { trackActiveSignals };
