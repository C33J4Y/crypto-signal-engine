const config = require('../config');

/**
 * Calculate Volume Profile over a fixed range of candles.
 * Distributes each candle's volume across price bins proportionally.
 *
 * @param {Array} candles - Array of candle objects
 * @param {number} lookback - Number of bars to analyze (default 100)
 * @param {number} numBins - Number of price bins (default 50)
 * @returns {{ poc: number, vah: number, val: number, bins: Array }}
 */
function calculateVolumeProfile(
  candles,
  lookback = config.scoring.volumeProfileLookback,
  numBins = config.scoring.volumeProfileBins
) {
  const recentCandles = candles.slice(-lookback);

  if (recentCandles.length < 10) {
    return { poc: null, vah: null, val: null, bins: [] };
  }

  // Determine price range
  let highestHigh = -Infinity;
  let lowestLow = Infinity;

  for (const c of recentCandles) {
    if (c.high > highestHigh) highestHigh = c.high;
    if (c.low < lowestLow) lowestLow = c.low;
  }

  const priceRange = highestHigh - lowestLow;
  if (priceRange === 0) {
    return { poc: highestHigh, vah: highestHigh, val: lowestLow, bins: [] };
  }

  const binSize = priceRange / numBins;

  // Initialize bins
  const bins = new Array(numBins).fill(0);

  // Distribute volume across bins
  for (const candle of recentCandles) {
    const candleRange = candle.high - candle.low;

    if (candleRange === 0) {
      // Doji or zero-range candle: all volume in one bin
      const binIdx = Math.min(
        Math.floor((candle.close - lowestLow) / binSize),
        numBins - 1
      );
      bins[binIdx] += candle.volume;
      continue;
    }

    // Determine which bins this candle spans
    const lowBin = Math.floor((candle.low - lowestLow) / binSize);
    const highBin = Math.min(
      Math.floor((candle.high - lowestLow) / binSize),
      numBins - 1
    );

    // Distribute volume proportionally across bins
    const spannedBins = highBin - lowBin + 1;
    const volumePerBin = candle.volume / spannedBins;

    for (let b = Math.max(0, lowBin); b <= highBin; b++) {
      bins[b] += volumePerBin;
    }
  }

  // Find POC (bin with highest volume)
  let maxVolume = 0;
  let pocBinIdx = 0;

  for (let i = 0; i < bins.length; i++) {
    if (bins[i] > maxVolume) {
      maxVolume = bins[i];
      pocBinIdx = i;
    }
  }

  // POC price = midpoint of the highest-volume bin
  const poc = lowestLow + (pocBinIdx + 0.5) * binSize;

  // Calculate Value Area (70% of total volume centered on POC)
  const totalVolume = bins.reduce((s, v) => s + v, 0);
  const valueAreaTarget = totalVolume * 0.7;

  let vaVolume = bins[pocBinIdx];
  let vaLowIdx = pocBinIdx;
  let vaHighIdx = pocBinIdx;

  while (vaVolume < valueAreaTarget) {
    const canGoLow = vaLowIdx > 0;
    const canGoHigh = vaHighIdx < numBins - 1;

    if (!canGoLow && !canGoHigh) break;

    const lowVol = canGoLow ? bins[vaLowIdx - 1] : -1;
    const highVol = canGoHigh ? bins[vaHighIdx + 1] : -1;

    if (lowVol >= highVol) {
      vaLowIdx--;
      vaVolume += bins[vaLowIdx];
    } else {
      vaHighIdx++;
      vaVolume += bins[vaHighIdx];
    }
  }

  const val = lowestLow + vaLowIdx * binSize;
  const vah = lowestLow + (vaHighIdx + 1) * binSize;

  return {
    poc: Math.round(poc * 100) / 100,
    vah: Math.round(vah * 100) / 100,
    val: Math.round(val * 100) / 100,
    bins: bins.map((vol, i) => ({
      priceLevel: Math.round((lowestLow + (i + 0.5) * binSize) * 100) / 100,
      volume: Math.round(vol * 100) / 100,
    })),
  };
}

/**
 * Analyze current price proximity to POC.
 * @param {Array} candles
 * @returns {{ poc: number, vah: number, val: number, distance: string, points: number }}
 */
function analyze(candles) {
  const profile = calculateVolumeProfile(candles);

  if (profile.poc === null) {
    return { poc: null, vah: null, val: null, distance: null, points: 0 };
  }

  const currentPrice = candles[candles.length - 1].close;
  const distancePercent = Math.abs(currentPrice - profile.poc) / profile.poc * 100;
  const proximity = config.risk.pocProximityPercent;

  // Graduated scoring: full points at POC, partial up to 2x proximity
  let points = 0;
  if (distancePercent <= proximity) {
    points = 1.5;
  } else if (distancePercent <= proximity * 2) {
    points = 0.75;
  }

  return {
    poc: profile.poc,
    vah: profile.vah,
    val: profile.val,
    distance: `${distancePercent.toFixed(2)}%`,
    points,
  };
}

module.exports = { calculateVolumeProfile, analyze };
