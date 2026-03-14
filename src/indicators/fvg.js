const db = require('../db/database');

/**
 * Detect Fair Value Gaps in candle data.
 * Bullish FVG: candle[i-2].high < candle[i].low (gap up)
 * Bearish FVG: candle[i-2].low > candle[i].high (gap down)
 *
 * @param {Array} candles - Array of candle objects
 * @param {string} symbol
 * @param {string} interval
 * @returns {{ newZones: Array, activeZones: Array }}
 */
function detectFVGs(candles, symbol, interval) {
  const newZones = [];

  if (candles.length < 3) {
    return { newZones, activeZones: [] };
  }

  // Scan for new FVGs (only check recent candles to avoid re-detecting old ones)
  // Check last 20 candles for new FVG patterns
  const startIdx = Math.max(2, candles.length - 20);

  for (let i = startIdx; i < candles.length; i++) {
    const candle1 = candles[i - 2]; // Two bars ago
    const candle3 = candles[i];     // Current bar

    // Bullish FVG: gap between candle1.high and candle3.low
    if (candle1.high < candle3.low) {
      newZones.push({
        symbol,
        interval,
        direction: 'bullish',
        zoneHigh: candle3.low,
        zoneLow: candle1.high,
        createdAt: candles[i - 1].open_time || candles[i - 1].openTime,
      });
    }

    // Bearish FVG: gap between candle3.high and candle1.low
    if (candle1.low > candle3.high) {
      newZones.push({
        symbol,
        interval,
        direction: 'bearish',
        zoneHigh: candle1.low,
        zoneLow: candle3.high,
        createdAt: candles[i - 1].open_time || candles[i - 1].openTime,
      });
    }
  }

  return { newZones };
}

/**
 * Store newly detected FVG zones in the database.
 */
function storeNewZones(zones) {
  for (const zone of zones) {
    db.upsertFvgZone(zone);
  }
}

/**
 * Check if active FVGs have been filled by current price action.
 * A bullish FVG is filled when price drops below the zone low.
 * A bearish FVG is filled when price rises above the zone high.
 */
function updateFilledZones(symbol, interval, currentCandle) {
  const activeZones = db.getActiveFvgZones(symbol, interval);
  const openTime = currentCandle.open_time || currentCandle.openTime;

  for (const zone of activeZones) {
    if (zone.direction === 'bullish') {
      // Filled when price trades fully through (low goes below zone_low)
      if (currentCandle.low <= zone.zone_low) {
        db.markFvgFilled(zone.id, openTime);
      }
    } else {
      // Bearish FVG filled when price trades fully through (high goes above zone_high)
      if (currentCandle.high >= zone.zone_high) {
        db.markFvgFilled(zone.id, openTime);
      }
    }
  }
}

/**
 * Check if current price is entering an active FVG zone.
 * @param {string} symbol
 * @param {string} interval
 * @param {number} currentPrice - Current close price
 * @returns {{ active: boolean, direction: string|null, zoneHigh: number|null, zoneLow: number|null, points: number }}
 */
function checkPriceInFVG(symbol, interval, currentPrice) {
  const activeZones = db.getActiveFvgZones(symbol, interval);

  for (const zone of activeZones) {
    if (currentPrice >= zone.zone_low && currentPrice <= zone.zone_high) {
      return {
        active: true,
        direction: zone.direction,
        zoneHigh: zone.zone_high,
        zoneLow: zone.zone_low,
        points: 2.0,
      };
    }
  }

  return {
    active: false,
    direction: null,
    zoneHigh: null,
    zoneLow: null,
    points: 0,
  };
}

/**
 * Full FVG analysis: detect new zones, update fills, check current price.
 */
function analyze(candles, symbol, interval) {
  if (candles.length < 3) {
    return {
      active: false,
      direction: null,
      zoneHigh: null,
      zoneLow: null,
      points: 0,
    };
  }

  const currentCandle = candles[candles.length - 1];
  const currentPrice = currentCandle.close;

  // Detect and store new FVGs
  const { newZones } = detectFVGs(candles, symbol, interval);
  storeNewZones(newZones);

  // Update filled zones
  updateFilledZones(symbol, interval, currentCandle);

  // Check if price is in an active FVG
  return checkPriceInFVG(symbol, interval, currentPrice);
}

module.exports = { detectFVGs, storeNewZones, updateFilledZones, checkPriceInFVG, analyze };
