const config = require('../config');
const db = require('../db/database');
const logger = require('../utils/logger');

const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff delays

/**
 * Parse a raw Binance kline array into a candle object.
 */
function parseKline(kline) {
  return {
    openTime: kline[0],
    open: parseFloat(kline[1]),
    high: parseFloat(kline[2]),
    low: parseFloat(kline[3]),
    close: parseFloat(kline[4]),
    volume: parseFloat(kline[5]),
    closeTime: kline[6],
    quoteVolume: parseFloat(kline[7]),
    numTrades: kline[8],
  };
}

/**
 * Attempt a single fetch from a given base URL.
 */
async function tryFetch(baseUrl, symbol, interval, limit) {
  const url = `${baseUrl}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const response = await fetch(url);

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
    logger.warn(`Rate limited, waiting ${retryAfter}s`, { baseUrl, symbol, interval });
    await sleep(retryAfter * 1000);
    throw new Error('Rate limited');
  }

  if (response.status === 451 || response.status === 403) {
    throw new Error(`Geo-blocked or forbidden: ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.map(parseKline);
}

/**
 * Fetch candles with retry logic and fallback URL.
 */
async function fetchCandles(symbol, interval, limit = config.candleHistoryLimit) {
  const urls = [config.binanceBaseUrl, config.binanceFallbackUrl].filter(Boolean);

  for (const baseUrl of urls) {
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        return await tryFetch(baseUrl, symbol, interval, limit);
      } catch (err) {
        const isGeoBlock = err.message.includes('Geo-blocked') || err.message.includes('forbidden');

        // If geo-blocked, skip retries and try next URL
        if (isGeoBlock) {
          logger.warn(`Geo-blocked on ${baseUrl}, trying fallback...`, { symbol, interval });
          break;
        }

        if (attempt < RETRY_DELAYS.length) {
          logger.warn(`Fetch attempt ${attempt + 1} failed, retrying...`, {
            symbol, interval, error: err.message,
          });
          await sleep(RETRY_DELAYS[attempt]);
        }
      }
    }
  }

  throw new Error(`Failed to fetch candles from all sources: ${symbol}/${interval}`);
}

/**
 * Fetch and store candles for a single symbol/interval pair.
 * Returns the number of candles upserted.
 */
async function fetchAndStore(symbol, interval) {
  const candles = await fetchCandles(symbol, interval);
  const count = db.upsertCandles(symbol, interval, candles);
  logger.debug(`Stored ${count} candles`, { symbol, interval });
  return count;
}

/**
 * Poll all configured symbols and timeframes.
 * Called on each cron tick.
 */
async function pollAll() {
  const startTime = Date.now();
  let totalCandles = 0;
  let errors = 0;

  for (const symbol of config.symbols) {
    for (const timeframe of config.timeframes) {
      try {
        const count = await fetchAndStore(symbol, timeframe);
        totalCandles += count;
      } catch (err) {
        errors++;
        logger.error(`Poll failed for ${symbol}/${timeframe}`, { error: err.message });
      }
    }
  }

  const elapsed = Date.now() - startTime;
  logger.info(`Poll complete`, {
    totalCandles,
    errors,
    elapsed: `${elapsed}ms`,
    symbols: config.symbols.length,
    timeframes: config.timeframes.length,
  });

  return { totalCandles, errors, elapsed };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { fetchCandles, fetchAndStore, pollAll, parseKline };
