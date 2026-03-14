const db = require('../../db/database');

function getForwardTestScores(req, res) {
  const { symbol, interval, minScore, since, limit } = req.query;
  const scores = db.getPollScores({
    symbol,
    interval,
    minScore: minScore ? parseFloat(minScore) : undefined,
    since,
    limit: limit ? parseInt(limit, 10) : 500,
  });

  // Parse fired JSON
  const parsed = scores.map(s => ({
    ...s,
    fired: JSON.parse(s.fired || '[]'),
  }));

  res.json({ count: parsed.length, scores: parsed });
}

function getForwardTestStats(req, res) {
  const { since } = req.query;
  const stats = db.getPollScoreStats(since);
  res.json({ since: since || 'all-time', stats });
}

function getForwardTestTimeline(req, res) {
  const { symbol, interval, hours } = req.query;
  const hoursBack = parseInt(hours || '24', 10);
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

  const scores = db.getPollScores({
    symbol,
    interval,
    since,
    limit: 5000,
  });

  // Group by poll_id to show per-cycle view
  const cycles = {};
  for (const s of scores) {
    if (!cycles[s.poll_id]) {
      cycles[s.poll_id] = { timestamp: s.timestamp, scores: [] };
    }
    cycles[s.poll_id].scores.push({
      symbol: s.symbol,
      interval: s.interval,
      direction: s.direction,
      score: s.score,
      grade: s.grade,
      fired: JSON.parse(s.fired || '[]'),
      regime: s.regime,
      rejectionReason: s.rejection_reason,
      signalGenerated: s.signal_generated === 1,
    });
  }

  // Convert to array sorted by time
  const timeline = Object.entries(cycles)
    .map(([pollId, data]) => ({ pollId, ...data }))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  res.json({ hoursBack, cycleCount: timeline.length, timeline });
}

module.exports = { getForwardTestScores, getForwardTestStats, getForwardTestTimeline };
