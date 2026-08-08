/**
 * Parameter grid definitions and utilities for backtest optimization.
 * Shared by walkForward.js and trainOptimize.js.
 */

// ─── Trade Param Grids ──────────────────────────────────────────

const TRADE_GRIDS = {
  full: {
    riskPct: [0.3, 0.5, 0.75, 1.0, 1.5],
    tp1RR: [0.8, 1.0, 1.2, 1.5, 2.0],
    tp2RR: [0, 2.0, 2.5, 3.0],
    maxBars: [12, 24, 48, 96],
  },
  reduced: {
    riskPct: [0.3, 0.75, 1.0],
    tp1RR: [1.0, 1.5, 2.0],
    tp2RR: [0, 2.0, 2.5],
    maxBars: [48, 96],
  },
};

// ─── Indicator Param Grids (for training optimization) ──────────

const INDICATOR_GRIDS = {
  reduced: {
    threshold: [4.0, 4.5, 5.0],
    rsiOversold: [25, 30],
    rsiOverbought: [70, 75],
    volumeSpikeMultiplier: [1.2, 1.5],
  },
  full: {
    threshold: [3.5, 4.0, 4.5, 5.0],
    rsiOversold: [25, 30, 35],
    rsiOverbought: [65, 70, 75],
    volumeSpikeMultiplier: [1.2, 1.5, 2.0],
  },
};

// ─── Grid Expansion ─────────────────────────────────────────────

function expandGrid(gridDef) {
  const keys = Object.keys(gridDef);
  if (keys.length === 0) return [{}];

  const combos = [];

  function recurse(idx, current) {
    if (idx === keys.length) {
      combos.push({ ...current });
      return;
    }
    const key = keys[idx];
    for (const val of gridDef[key]) {
      current[key] = val;
      recurse(idx + 1, current);
    }
  }

  recurse(0, {});
  return combos;
}

// ─── Scoring function for ranking param sets ────────────────────

function rankScore(metrics) {
  // Reward profitability + statistical significance
  if (metrics.total < 5 || metrics.profitFactor === 0) return -Infinity;
  const pf = metrics.profitFactor === Infinity ? 10 : metrics.profitFactor;
  return pf * Math.sqrt(metrics.wins + metrics.losses);
}

module.exports = {
  TRADE_GRIDS,
  INDICATOR_GRIDS,
  expandGrid,
  rankScore,
};
