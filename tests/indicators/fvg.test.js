const { describe, it } = require('node:test');
const assert = require('node:assert');
const { detectFVGs } = require('../../src/indicators/fvg');

describe('FVG Detection', () => {
  it('should detect a bullish FVG (gap up)', () => {
    const candles = [
      { open: 100, high: 102, low: 99, close: 101, volume: 100, openTime: 1000 },
      { open: 103, high: 105, low: 103, close: 104, volume: 100, openTime: 2000 },
      { open: 104, high: 108, low: 104, close: 107, volume: 100, openTime: 3000 },
    ];

    // candle[0].high = 102, candle[2].low = 104 → 102 < 104 → bullish FVG
    const { newZones } = detectFVGs(candles, 'BTCUSDT', '15m');
    const bullish = newZones.filter(z => z.direction === 'bullish');

    assert.ok(bullish.length >= 1, 'Should detect bullish FVG');
    assert.strictEqual(bullish[0].zoneLow, 102);  // candle1.high
    assert.strictEqual(bullish[0].zoneHigh, 104);  // candle3.low
  });

  it('should detect a bearish FVG (gap down)', () => {
    const candles = [
      { open: 110, high: 112, low: 108, close: 109, volume: 100, openTime: 1000 },
      { open: 107, high: 107, low: 105, close: 106, volume: 100, openTime: 2000 },
      { open: 105, high: 106, low: 103, close: 104, volume: 100, openTime: 3000 },
    ];

    // candle[0].low = 108, candle[2].high = 106 → 108 > 106 → bearish FVG
    const { newZones } = detectFVGs(candles, 'BTCUSDT', '15m');
    const bearish = newZones.filter(z => z.direction === 'bearish');

    assert.ok(bearish.length >= 1, 'Should detect bearish FVG');
    assert.strictEqual(bearish[0].zoneHigh, 108);  // candle1.low
    assert.strictEqual(bearish[0].zoneLow, 106);    // candle3.high
  });

  it('should not detect FVG when no gap exists', () => {
    const candles = [
      { open: 100, high: 105, low: 99, close: 104, volume: 100, openTime: 1000 },
      { open: 104, high: 106, low: 103, close: 105, volume: 100, openTime: 2000 },
      { open: 105, high: 107, low: 103, close: 106, volume: 100, openTime: 3000 },
    ];

    // candle[0].high = 105, candle[2].low = 103 → 105 > 103 → no bullish FVG
    // candle[0].low = 99, candle[2].high = 107 → 99 < 107 → no bearish FVG
    const { newZones } = detectFVGs(candles, 'BTCUSDT', '15m');
    assert.strictEqual(newZones.length, 0, 'Should not detect any FVG');
  });

  it('should handle insufficient candles', () => {
    const candles = [
      { open: 100, high: 102, low: 99, close: 101, volume: 100, openTime: 1000 },
    ];
    const { newZones } = detectFVGs(candles, 'BTCUSDT', '15m');
    assert.strictEqual(newZones.length, 0);
  });
});
