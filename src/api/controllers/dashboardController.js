const db = require('../../db/database');
const config = require('../../config');
const rsi = require('../../indicators/rsi');
const volumeProfile = require('../../indicators/volumeProfile');
const volume = require('../../indicators/volume');
const smaRibbon = require('../../indicators/smaRibbon');
const fvg = require('../../indicators/fvg');

function getDashboard(req, res) {
  const dashboard = {};

  for (const symbol of config.symbols) {
    dashboard[symbol] = {};
    for (const interval of config.timeframes) {
      const candles = db.getCandles(symbol, interval, 500);
      if (candles.length === 0) {
        dashboard[symbol][interval] = { status: 'no_data' };
        continue;
      }

      const latestCandle = candles[candles.length - 1];
      const rsiResult = rsi.analyze(candles);
      const vpResult = volumeProfile.analyze(candles);
      const volResult = volume.analyze(candles);
      const smaResult = smaRibbon.analyze(candles);
      const activeFvgs = db.getActiveFvgZones(symbol, interval);

      dashboard[symbol][interval] = {
        price: latestCandle.close,
        change24h: candles.length > 96
          ? ((latestCandle.close - candles[candles.length - 97].close) / candles[candles.length - 97].close * 100).toFixed(2) + '%'
          : null,
        rsi: rsiResult.value,
        rsiCondition: rsiResult.condition,
        poc: vpResult.poc,
        vah: vpResult.vah,
        val: vpResult.val,
        sma50: smaResult.sma50,
        sma100: smaResult.sma100,
        smaAlignment: smaResult.alignment,
        volumeRatio: volResult.ratio,
        volumeSpike: volResult.spike,
        activeFvgs: activeFvgs.length,
        candleCount: candles.length,
        lastUpdate: new Date(latestCandle.close_time).toISOString(),
      };
    }
  }

  res.json(dashboard);
}

module.exports = { getDashboard };
