const binanceStream = require('../../realtime/binanceStream');
const config = require('../../config');
const logger = require('../../utils/logger');

// Track SSE client count per stream so we can unsubscribe when nobody is watching
const clientCounts = new Map(); // "BTCUSDT:15m" → number

// All valid intervals for streaming (trading + scalping + HTF)
const VALID_STREAM_INTERVALS = ['1m', '5m', '15m', '1h', '4h'];

function streamCandles(req, res) {
  const { symbol, interval } = req.params;

  if (!config.symbols.includes(symbol)) {
    return res.status(400).json({ error: `Invalid symbol: ${symbol}` });
  }
  if (!VALID_STREAM_INTERVALS.includes(interval)) {
    return res.status(400).json({ error: `Invalid interval: ${interval}` });
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.flushHeaders();

  // Subscribe to Binance stream
  const streamKey = `${symbol}:${interval}`;
  const count = (clientCounts.get(streamKey) || 0) + 1;
  clientCounts.set(streamKey, count);

  binanceStream.subscribe(symbol, interval);

  // Forward kline events to this SSE client
  const handler = (candle) => {
    const data = JSON.stringify(candle);
    res.write(`data: ${data}\n\n`);
  };

  binanceStream.on(`kline:${symbol}:${interval}`, handler);

  // Send keepalive every 15s to prevent proxy/timeout disconnects
  const keepalive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  // Cleanup on client disconnect
  req.on('close', () => {
    binanceStream.off(`kline:${symbol}:${interval}`, handler);
    clearInterval(keepalive);

    const remaining = (clientCounts.get(streamKey) || 1) - 1;
    clientCounts.set(streamKey, remaining);

    // Unsubscribe from Binance if no clients are watching this stream
    if (remaining <= 0) {
      clientCounts.delete(streamKey);
      binanceStream.unsubscribe(symbol, interval);
      logger.debug(`SSE stream closed, unsubscribed: ${streamKey}`);
    }
  });
}

module.exports = { streamCandles };
