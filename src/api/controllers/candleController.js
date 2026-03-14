const db = require('../../db/database');
const config = require('../../config');

function getCandles(req, res) {
  const { symbol, interval } = req.params;
  const limit = Math.min(parseInt(req.query.limit || '500', 10), 1000);

  if (!config.symbols.includes(symbol)) {
    return res.status(400).json({ error: `Invalid symbol: ${symbol}` });
  }

  const validIntervals = ['1m', '5m', '15m', '1h', '4h'];
  if (!validIntervals.includes(interval)) {
    return res.status(400).json({ error: `Invalid interval: ${interval}` });
  }

  const candles = db.getCandles(symbol, interval, limit);

  // Map to lightweight-charts format
  const data = candles.map(c => ({
    time: Math.floor(c.open_time / 1000),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));

  res.json({ symbol, interval, count: data.length, candles: data });
}

module.exports = { getCandles };
