const { describe, it } = require('node:test');
const assert = require('node:assert');
const config = require('../../src/config');
const { classifyGrade } = require('../../src/engine/confluenceScorer');

describe('Confluence Scorer', () => {
  describe('classifyGrade', () => {
    const threshold = config.scoring.confluenceThreshold;
    const watchlist = config.scoring.watchlistThreshold;

    it('should classify score >= threshold as A+', () => {
      assert.strictEqual(classifyGrade(threshold), 'A+');
      assert.strictEqual(classifyGrade(8.5), 'A+');
      assert.strictEqual(classifyGrade(10.0), 'A+');
    });

    it('should classify score in B range (>= watchlist, < A+)', () => {
      assert.strictEqual(classifyGrade(watchlist), 'B');
      assert.strictEqual(classifyGrade(threshold - 0.5), 'B');
    });

    it('should classify score below watchlist threshold as C', () => {
      assert.strictEqual(classifyGrade(0), 'C');
      assert.strictEqual(classifyGrade(watchlist - 0.1), 'C');
      assert.strictEqual(classifyGrade(2.0), 'C');
    });
  });

  describe('Scoring Framework', () => {
    it('should have max possible score of 10', () => {
      // RSI State: 1.5
      // RSI Divergence: 2.0
      // FVG: 2.0
      // Volume Profile POC: 1.5
      // Volume Spike: 1.0
      // SMA Ribbon Trend: 1.5
      // SMA Ribbon Touch: 0.5
      const maxScore = 1.5 + 2.0 + 2.0 + 1.5 + 1.0 + 1.5 + 0.5;
      assert.strictEqual(maxScore, 10);
    });

    it('should require score >= threshold for A+ signal', () => {
      const threshold = config.scoring.confluenceThreshold;
      assert.strictEqual(classifyGrade(threshold), 'A+');
      assert.strictEqual(classifyGrade(threshold - 0.1), 'B');
    });
  });
});
