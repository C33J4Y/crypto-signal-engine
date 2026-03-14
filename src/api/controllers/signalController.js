const db = require('../../db/database');

function listSignals(req, res) {
  const filters = {
    symbol: req.query.symbol,
    interval: req.query.interval,
    grade: req.query.grade,
    status: req.query.status,
    direction: req.query.direction,
    limit: req.query.limit ? parseInt(req.query.limit, 10) : 50,
  };

  const signals = db.getSignals(filters);

  // Parse indicators_json for each signal
  const parsed = signals.map(s => ({
    ...s,
    indicators: JSON.parse(s.indicators_json),
  }));

  res.json({ signals: parsed, count: parsed.length });
}

function getSignal(req, res) {
  const signal = db.getSignalById(req.params.id);
  if (!signal) {
    return res.status(404).json({ error: 'Signal not found' });
  }

  res.json({
    ...signal,
    indicators: JSON.parse(signal.indicators_json),
  });
}

module.exports = { listSignals, getSignal };
