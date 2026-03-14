const db = require('../../db/database');

function getPerformance(req, res) {
  const allSignals = db.getSignals({});

  if (allSignals.length === 0) {
    return res.json({
      total: 0,
      active: 0,
      wins: 0,
      losses: 0,
      expired: 0,
      winRate: '0%',
      avgPnl: 0,
      bySymbol: {},
      byTimeframe: {},
    });
  }

  const stats = {
    total: allSignals.length,
    active: 0,
    wins: 0,
    losses: 0,
    expired: 0,
    totalPnl: 0,
    completedCount: 0,
    bySymbol: {},
    byTimeframe: {},
  };

  for (const signal of allSignals) {
    // Overall stats
    if (signal.status === 'active') stats.active++;
    else if (signal.status === 'stopped_out') stats.losses++;
    else if (signal.status === 'expired') stats.expired++;
    else if (signal.status.startsWith('tp')) stats.wins++;

    if (signal.outcome_pnl !== null) {
      stats.totalPnl += signal.outcome_pnl;
      stats.completedCount++;
    }

    // By symbol
    if (!stats.bySymbol[signal.symbol]) {
      stats.bySymbol[signal.symbol] = { total: 0, wins: 0, losses: 0 };
    }
    stats.bySymbol[signal.symbol].total++;
    if (signal.status.startsWith('tp')) stats.bySymbol[signal.symbol].wins++;
    if (signal.status === 'stopped_out') stats.bySymbol[signal.symbol].losses++;

    // By timeframe
    if (!stats.byTimeframe[signal.interval]) {
      stats.byTimeframe[signal.interval] = { total: 0, wins: 0, losses: 0 };
    }
    stats.byTimeframe[signal.interval].total++;
    if (signal.status.startsWith('tp')) stats.byTimeframe[signal.interval].wins++;
    if (signal.status === 'stopped_out') stats.byTimeframe[signal.interval].losses++;
  }

  const decided = stats.wins + stats.losses;

  res.json({
    total: stats.total,
    active: stats.active,
    wins: stats.wins,
    losses: stats.losses,
    expired: stats.expired,
    winRate: decided > 0 ? `${((stats.wins / decided) * 100).toFixed(1)}%` : 'N/A',
    avgPnl: stats.completedCount > 0
      ? Math.round((stats.totalPnl / stats.completedCount) * 100) / 100
      : 0,
    bySymbol: stats.bySymbol,
    byTimeframe: stats.byTimeframe,
  });
}

module.exports = { getPerformance };
