const { describe, it } = require('node:test');
const assert = require('node:assert');
const { calculateVolumeProfile } = require('../../src/indicators/volumeProfile');

describe('Volume Profile', () => {
  function makeCandles(data) {
    return data.map(([open, high, low, close, volume], i) => ({
      open, high, low, close, volume,
      open_time: i * 60000,
    }));
  }

  it('should calculate POC at the highest volume bin', () => {
    // Create candles where most volume is concentrated around price 105
    const candles = [];
    for (let i = 0; i < 50; i++) {
      // Most candles trade around 105 with high volume
      candles.push({
        open: 104, high: 106, low: 104, close: 105,
        volume: 1000, open_time: i * 60000,
      });
    }
    // Some candles trade at 110 with lower volume
    for (let i = 50; i < 70; i++) {
      candles.push({
        open: 109, high: 111, low: 109, close: 110,
        volume: 100, open_time: i * 60000,
      });
    }

    const result = calculateVolumeProfile(candles, 70, 20);

    assert.ok(result.poc !== null, 'POC should be calculated');
    // POC should be near 105 where most volume is
    assert.ok(result.poc >= 104 && result.poc <= 106,
      `POC should be near 105, got ${result.poc}`);
  });

  it('should calculate VAH above POC and VAL below POC', () => {
    const candles = [];
    for (let i = 0; i < 100; i++) {
      const base = 100 + Math.sin(i * 0.1) * 10;
      candles.push({
        open: base, high: base + 2, low: base - 2, close: base + 1,
        volume: 500, open_time: i * 60000,
      });
    }

    const result = calculateVolumeProfile(candles, 100, 50);

    assert.ok(result.vah > result.poc || result.vah === result.poc,
      'VAH should be >= POC');
    assert.ok(result.val < result.poc || result.val === result.poc,
      'VAL should be <= POC');
    assert.ok(result.vah > result.val, 'VAH should be > VAL');
  });

  it('should return null for insufficient data', () => {
    const candles = makeCandles([
      [100, 102, 99, 101, 100],
    ]);
    const result = calculateVolumeProfile(candles, 100, 50);
    assert.strictEqual(result.poc, null);
  });

  it('should handle uniform volume distribution', () => {
    const candles = [];
    for (let i = 0; i < 50; i++) {
      const price = 100 + i * 0.5;
      candles.push({
        open: price, high: price + 0.5, low: price - 0.5, close: price,
        volume: 100, open_time: i * 60000,
      });
    }

    const result = calculateVolumeProfile(candles, 50, 20);
    assert.ok(result.poc !== null);
    assert.ok(result.bins.length === 20);
  });
});
