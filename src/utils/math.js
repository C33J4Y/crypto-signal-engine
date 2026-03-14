/**
 * Simple Moving Average over the last `period` values.
 */
function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

/**
 * Exponential Moving Average (Wilder smoothing).
 * Returns full EMA series for the given values.
 */
function ema(values, period) {
  if (values.length < period) return [];
  const k = 1 / period; // Wilder smoothing factor
  const result = [];

  // Seed with SMA of first `period` values
  let prev = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  result.push(prev);

  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    result.push(prev);
  }

  return result;
}

module.exports = { sma, ema };
