const { describe, it } = require('node:test');
const assert = require('node:assert');
const { calculateRSI, findSwingLows, findSwingHighs } = require('../../src/indicators/rsi');

describe('RSI', () => {
  // Generate synthetic candles with known close prices
  function makeCandles(closes) {
    return closes.map((close, i) => ({
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 100,
      open_time: i * 60000,
    }));
  }

  it('should return null for insufficient data', () => {
    const candles = makeCandles([100, 101, 102]);
    const result = calculateRSI(candles, 14);
    assert.strictEqual(result.current, null);
    assert.deepStrictEqual(result.values, []);
  });

  it('should compute RSI for a steady uptrend (all gains)', () => {
    // 16 candles, each +1 from previous = all gains, zero losses
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const candles = makeCandles(closes);
    const result = calculateRSI(candles, 14);

    assert.ok(result.current !== null);
    // With all gains and no losses, RSI should be near 100
    assert.ok(result.current > 95, `Expected RSI > 95, got ${result.current}`);
  });

  it('should compute RSI for a steady downtrend (all losses)', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 200 - i);
    const candles = makeCandles(closes);
    const result = calculateRSI(candles, 14);

    assert.ok(result.current !== null);
    // With all losses and no gains, RSI should be near 0
    assert.ok(result.current < 5, `Expected RSI < 5, got ${result.current}`);
  });

  it('should compute RSI near 50 for alternating gains/losses', () => {
    const closes = [];
    for (let i = 0; i < 30; i++) {
      closes.push(100 + (i % 2 === 0 ? 1 : -1));
    }
    const candles = makeCandles(closes);
    const result = calculateRSI(candles, 14);

    assert.ok(result.current !== null);
    // Alternating equal gains/losses should yield RSI near 50
    assert.ok(result.current > 40 && result.current < 60,
      `Expected RSI near 50, got ${result.current}`);
  });

  it('should return correct number of RSI values', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 5);
    const candles = makeCandles(closes);
    const result = calculateRSI(candles, 14);

    // First RSI value starts at index=period (using period changes, so period+1 candles needed)
    // With 30 candles and period 14: 29 changes, first RSI at index 14, so 29-14+1 = 16 values
    assert.strictEqual(result.values.length, 16);
  });
});

describe('Swing Detection', () => {
  it('should find swing lows', () => {
    const values = [10, 8, 6, 4, 2, 1, 2, 4, 6, 8, 10, 12, 14];
    const swings = findSwingLows(values, 3);
    assert.ok(swings.length >= 1);
    assert.strictEqual(swings[0].value, 1);
  });

  it('should find swing highs', () => {
    const values = [1, 3, 5, 7, 9, 10, 9, 7, 5, 3, 1];
    const swings = findSwingHighs(values, 3);
    assert.ok(swings.length >= 1);
    assert.strictEqual(swings[0].value, 10);
  });

  it('should return empty for flat data', () => {
    const values = Array(20).fill(5);
    assert.strictEqual(findSwingLows(values, 3).length, 0);
    assert.strictEqual(findSwingHighs(values, 3).length, 0);
  });
});
