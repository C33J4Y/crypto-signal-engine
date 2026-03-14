#!/usr/bin/env node
/**
 * Fetch historical kline data from Binance and save as CSV.
 *
 * Usage:
 *   node src/fetchHistoricalCsv.js --symbol BTCUSDT --interval 15m --days 30
 *   node src/fetchHistoricalCsv.js --symbol ETHUSDT --interval 1h --days 90 --output data/eth_1h.csv
 *
 * Options:
 *   --symbol    Trading pair (required)
 *   --interval  Candle interval: 1m, 5m, 15m, 1h, 4h, 1d (required)
 *   --days      How many days of history to fetch (default: 30)
 *   --output    Output file path (default: data/<symbol>_<interval>_<days>d.csv)
 *   --help      Show this help
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const BASE_URLS = [
  process.env.BINANCE_BASE_URL || 'https://data-api.binance.vision/api/v3',
  'https://api.binance.us/api/v3',
];

const BATCH_SIZE = 1000; // Binance max per request
const RATE_LIMIT_MS = 300; // Pause between requests to avoid 429s

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { symbol: null, interval: null, days: 30, output: null };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--symbol': opts.symbol = args[++i]; break;
      case '--interval': opts.interval = args[++i]; break;
      case '--days': opts.days = parseInt(args[++i], 10); break;
      case '--output': opts.output = args[++i]; break;
      case '--help': case '-h':
        console.log(`
Fetch Historical Candles → CSV

Usage: node src/fetchHistoricalCsv.js --symbol BTCUSDT --interval 15m --days 30

Options:
  --symbol BTCUSDT     Trading pair (required)
  --interval 15m       Candle interval: 1m, 5m, 15m, 1h, 4h, 1d (required)
  --days 30            Days of history to fetch (default: 30)
  --output file.csv    Output path (default: data/<symbol>_<interval>_<days>d.csv)
  --help               Show this help

Examples:
  node src/fetchHistoricalCsv.js --symbol BTCUSDT --interval 15m --days 30
  node src/fetchHistoricalCsv.js --symbol ETHUSDT --interval 1h --days 90
  node src/fetchHistoricalCsv.js --symbol SOLUSDT --interval 15m --days 60 --output data/sol_15m.csv
`);
        process.exit(0);
    }
  }

  if (!opts.symbol) { console.error('Error: --symbol is required'); process.exit(1); }
  if (!opts.interval) { console.error('Error: --interval is required'); process.exit(1); }

  if (!opts.output) {
    opts.output = path.join('data', `${opts.symbol}_${opts.interval}_${opts.days}d.csv`);
  }

  return opts;
}

function intervalToMs(interval) {
  const map = {
    '1m': 60_000,
    '3m': 180_000,
    '5m': 300_000,
    '15m': 900_000,
    '30m': 1_800_000,
    '1h': 3_600_000,
    '2h': 7_200_000,
    '4h': 14_400_000,
    '1d': 86_400_000,
  };
  return map[interval] || null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchBatch(baseUrl, symbol, interval, startTime, endTime) {
  const url = `${baseUrl}/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${BATCH_SIZE}`;
  const response = await fetch(url);

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
    console.log(`  Rate limited, waiting ${retryAfter}s...`);
    await sleep(retryAfter * 1000);
    throw new Error('rate_limited');
  }

  if (response.status === 451 || response.status === 403) {
    throw new Error('geo_blocked');
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

async function fetchAllCandles(symbol, interval, days) {
  const intervalMs = intervalToMs(interval);
  if (!intervalMs) {
    console.error(`Unknown interval: ${interval}`);
    process.exit(1);
  }

  const endTime = Date.now();
  const startTime = endTime - days * 24 * 60 * 60 * 1000;
  const totalCandles = Math.ceil((endTime - startTime) / intervalMs);
  const totalBatches = Math.ceil(totalCandles / BATCH_SIZE);

  console.log(`Fetching ${symbol} ${interval} — ~${totalCandles} candles in ~${totalBatches} batches`);
  console.log(`Range: ${new Date(startTime).toISOString()} → ${new Date(endTime).toISOString()}`);

  const allCandles = [];
  let cursor = startTime;
  let batch = 0;

  while (cursor < endTime) {
    batch++;
    let fetched = false;

    for (const baseUrl of BASE_URLS) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const klines = await fetchBatch(baseUrl, symbol, interval, cursor, endTime);

          if (klines.length === 0) {
            fetched = true;
            break;
          }

          for (const k of klines) {
            allCandles.push({
              open_time: k[0],
              open: parseFloat(k[1]),
              high: parseFloat(k[2]),
              low: parseFloat(k[3]),
              close: parseFloat(k[4]),
              volume: parseFloat(k[5]),
              close_time: k[6],
              quote_volume: parseFloat(k[7]),
              num_trades: k[8],
            });
          }

          // Move cursor past the last candle we received
          cursor = klines[klines.length - 1][0] + intervalMs;
          fetched = true;

          const pct = Math.min(100, ((cursor - startTime) / (endTime - startTime) * 100)).toFixed(0);
          process.stdout.write(`\r  Batch ${batch}/${totalBatches} — ${allCandles.length} candles (${pct}%)`);

          await sleep(RATE_LIMIT_MS);
          break;
        } catch (err) {
          if (err.message === 'geo_blocked') break; // Try next URL
          if (err.message === 'rate_limited') continue; // Retry same URL
          if (attempt < 2) {
            await sleep(1000 * (attempt + 1));
          }
        }
      }

      if (fetched) break;
    }

    if (!fetched) {
      console.error(`\nFailed to fetch batch at ${new Date(cursor).toISOString()}`);
      break;
    }
  }

  console.log(`\n  Total: ${allCandles.length} candles fetched`);
  return allCandles;
}

function writeCsv(candles, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const header = 'open_time,open,high,low,close,volume,close_time,quote_volume,num_trades';
  const lines = candles.map(c =>
    `${c.open_time},${c.open},${c.high},${c.low},${c.close},${c.volume},${c.close_time},${c.quote_volume},${c.num_trades}`
  );

  fs.writeFileSync(outputPath, [header, ...lines].join('\n') + '\n');
  console.log(`  Saved to ${outputPath}`);
}

async function main() {
  const opts = parseArgs();

  console.log('='.repeat(60));
  console.log('  Binance Historical Data → CSV');
  console.log('='.repeat(60));

  const candles = await fetchAllCandles(opts.symbol, opts.interval, opts.days);

  if (candles.length === 0) {
    console.log('No data fetched.');
    process.exit(1);
  }

  writeCsv(candles, opts.output);

  console.log('\nReady to backtest:');
  console.log(`  node src/backtest.js --csv ${opts.output} --symbol ${opts.symbol} --interval ${opts.interval}`);
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
