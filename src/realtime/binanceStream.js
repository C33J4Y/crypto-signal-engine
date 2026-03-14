const WebSocket = require('ws');
const { EventEmitter } = require('events');
const logger = require('../utils/logger');

const WS_URLS = [
  'wss://stream.binance.vision/ws',
  'wss://stream.binance.us:9443/ws',
];

class BinanceStream extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map(); // key: "btcusdt@kline_15m" → ws
    this.reconnectTimers = new Map();
    this.wsUrlIndex = 0; // track which URL is working
  }

  /**
   * Subscribe to a kline stream. Reuses existing connection if already open.
   * @param {string} symbol - e.g. "BTCUSDT"
   * @param {string} interval - e.g. "15m"
   */
  subscribe(symbol, interval) {
    const streamKey = `${symbol.toLowerCase()}@kline_${interval}`;
    if (this.connections.has(streamKey)) return;

    this._connect(streamKey, symbol, interval);
  }

  /**
   * Unsubscribe from a kline stream if no listeners remain.
   * @param {string} symbol
   * @param {string} interval
   */
  unsubscribe(symbol, interval) {
    const streamKey = `${symbol.toLowerCase()}@kline_${interval}`;
    const ws = this.connections.get(streamKey);
    if (ws) {
      ws.close();
      this.connections.delete(streamKey);
      const timer = this.reconnectTimers.get(streamKey);
      if (timer) {
        clearTimeout(timer);
        this.reconnectTimers.delete(streamKey);
      }
    }
  }

  _connect(streamKey, symbol, interval, attempt = 0) {
    const urlBase = WS_URLS[this.wsUrlIndex];
    const url = `${urlBase}/${streamKey}`;

    logger.debug(`Binance WS connecting: ${url}`);

    const ws = new WebSocket(url);
    this.connections.set(streamKey, ws);

    ws.on('open', () => {
      logger.info(`Binance WS connected: ${streamKey}`);
      attempt = 0; // reset on success
    });

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw);
        if (data.e !== 'kline') return;

        const k = data.k;
        const candle = {
          symbol: k.s,
          interval: k.i,
          time: Math.floor(k.t / 1000), // open time in seconds
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
          isClosed: k.x, // true when candle is final
        };

        // Emit per-stream event and a generic event
        this.emit(`kline:${symbol}:${interval}`, candle);
        this.emit('kline', candle);
      } catch (err) {
        logger.warn('Binance WS parse error', { error: err.message });
      }
    });

    ws.on('error', (err) => {
      logger.warn(`Binance WS error on ${streamKey}`, { error: err.message });
    });

    ws.on('close', () => {
      this.connections.delete(streamKey);

      // Try fallback URL on first disconnect, then reconnect with backoff
      if (attempt === 0 && this.wsUrlIndex < WS_URLS.length - 1) {
        this.wsUrlIndex++;
        logger.info(`Binance WS switching to fallback: ${WS_URLS[this.wsUrlIndex]}`);
        this._connect(streamKey, symbol, interval, 0);
        return;
      }

      const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
      logger.debug(`Binance WS reconnecting ${streamKey} in ${delay}ms`);

      const timer = setTimeout(() => {
        this.reconnectTimers.delete(streamKey);
        this._connect(streamKey, symbol, interval, attempt + 1);
      }, delay);

      this.reconnectTimers.set(streamKey, timer);
    });
  }

  /**
   * Close all connections and clean up.
   */
  shutdown() {
    for (const [key, ws] of this.connections) {
      ws.close();
    }
    this.connections.clear();
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
    this.removeAllListeners();
  }
}

// Singleton
const stream = new BinanceStream();
module.exports = stream;
