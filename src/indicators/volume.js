const config = require('../config');
const { sma } = require('../utils/math');

/**
 * Detect volume spikes (current volume >= multiplier × average volume).
 * @param {Array} candles - Array of candle objects
 * @param {number} avgPeriod - Period for volume SMA (default 20)
 * @param {number} multiplier - Spike threshold multiplier (default 2.0)
 * @returns {{ current: number, average: number, ratio: number, spike: boolean, points: number }}
 */
function analyze(
  candles,
  avgPeriod = config.scoring.volumeAvgPeriod,
  multiplier = config.scoring.volumeSpikeMultiplier
) {
  if (candles.length < avgPeriod + 1) {
    return { current: 0, average: 0, ratio: 0, spike: false, points: 0 };
  }

  const volumes = candles.map(c => c.volume);
  const currentVolume = volumes[volumes.length - 1];

  // Average of the previous `avgPeriod` candles (excluding current)
  const prevVolumes = volumes.slice(-(avgPeriod + 1), -1);
  const avgVolume = prevVolumes.reduce((s, v) => s + v, 0) / prevVolumes.length;

  const ratio = avgVolume > 0 ? currentVolume / avgVolume : 0;
  const spike = ratio >= multiplier;
  // Graduated: full spike = 1.0, elevated (1.2x+) = 0.5
  const elevated = ratio >= 1.2;

  return {
    current: Math.round(currentVolume * 100) / 100,
    average: Math.round(avgVolume * 100) / 100,
    ratio: Math.round(ratio * 100) / 100,
    spike,
    elevated,
    points: spike ? 1.0 : (elevated ? 0.5 : 0),
  };
}

module.exports = { analyze };
