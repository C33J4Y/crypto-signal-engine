const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'];

function formatTimestamp() {
  return new Date().toISOString();
}

function log(level, message, data) {
  if (LOG_LEVELS[level] < currentLevel) return;

  const entry = {
    timestamp: formatTimestamp(),
    level: level.toUpperCase(),
    message,
    ...(data && { data }),
  };

  const output = `[${entry.timestamp}] ${entry.level}: ${entry.message}${
    data ? ' ' + JSON.stringify(data) : ''
  }`;

  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

module.exports = {
  debug: (msg, data) => log('debug', msg, data),
  info: (msg, data) => log('info', msg, data),
  warn: (msg, data) => log('warn', msg, data),
  error: (msg, data) => log('error', msg, data),
};
