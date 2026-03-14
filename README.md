# Crypto Signal Engine

A real-time cryptocurrency trading signal engine that uses multi-indicator confluence scoring to generate actionable trade setups. Monitors **BTC**, **ETH**, and **SOL** on 15-minute and 1-hour timeframes with a full-stack dashboard for visualization.

Built for traders who want systematic, data-driven entries with defined risk management — not guesswork.

## How It Works

The engine polls Binance every 60 seconds, runs 5 technical indicators on each symbol/timeframe pair, and scores confluence on a 0–10 scale. When enough indicators align (A+ grade), it generates a full signal with entry, stop-loss, and three take-profit levels.

### Confluence Scoring (max 10 points)

| Indicator | What It Detects | Points |
|-----------|----------------|--------|
| RSI (14) | Oversold/overbought + graduated near-levels | 0.75–1.5 |
| RSI Divergence | Price vs RSI swing divergence | 2.0 |
| Fair Value Gap | Unfilled institutional price gaps | 2.0 |
| Volume Profile | Price near Point of Control (POC) | 0.75–1.5 |
| Volume Spike | Elevated volume confirmation | 0.5–1.0 |
| SMA Ribbon | 50/100 SMA trend alignment + pullback | 1.5–2.0 |

### Regime-Adaptive Strategy

The default strategy detects market regime using 4-hour HTF data:

- **Trending Bull/Bear** — prioritizes with-trend setups (SMA alignment, pullback entries) while still allowing counter-trend plays on strong divergence
- **Ranging** — switches to mean-reversion logic (RSI extremes, Value Area boundaries)
- **Unknown** — falls back to balanced scoring across all indicators

### Signal Generation

When a setup scores above threshold:
1. **Entry** is calculated from FVG zone midpoint (if active) or current close
2. **Stop-loss** is the tightest valid level from: FVG boundary, Value Area edge, SMA 100, or recent swing
3. **Take-profits** at configurable R:R ratios (default 1.5:1, 2.5:1, 4:1)
4. Signal is validated for minimum R:R before being stored and dispatched

## Tech Stack

- **Backend**: Node.js + Express v5 + better-sqlite3 + node-cron
- **Frontend**: React 19 + Vite + lightweight-charts v5
- **Data**: Binance Vision API (no API key required)
- **Real-time**: Binance WebSocket -> Server-Sent Events (SSE)
- **Notifications**: Discord and Telegram webhook support

## Prerequisites

- **Node.js** >= 18 (tested on v22)
- **npm** >= 9
- No API keys needed — uses Binance's public market data endpoints

## Quick Start

```bash
# Clone
git clone https://github.com/C33J4Y/crypto-signal-engine.git
cd crypto-signal-engine

# Install backend dependencies
npm install

# Install frontend dependencies
cd frontend && npm install && cd ..

# Configure environment
cp .env.example .env
# Edit .env to customize thresholds, symbols, notifications, etc.

# Start the engine
npm start
```

The server starts on `http://localhost:3002`. The first poll fetches candle data and begins scoring immediately.

### Frontend Development

To run the frontend with hot-reload during development:

```bash
# Terminal 1 — backend
npm start

# Terminal 2 — frontend dev server
cd frontend
npm run dev
```

Frontend dev server runs on `http://localhost:5173` and proxies API calls to the backend.

### Production Build

```bash
cd frontend && npm run build && cd ..
npm start
```

The backend serves the built frontend from `frontend/dist/`.

## Dashboard Pages

- **Dashboard** — live indicator readings, active signals, and regime status for all symbols
- **Charts** — real-time candlestick charts with SMA overlay, streamed via Binance WebSocket
- **Signal History** — all generated signals with entry/SL/TP levels and outcomes
- **Performance** — win rate, profit factor, and outcome tracking
- **Forward Test** — poll-by-poll scoring log showing what the engine computes every cycle, with rejection reasons
- **Settings** — webhook configuration for Discord/Telegram notifications

## Configuration

All settings are in `.env`. Key parameters:

```bash
# Symbols and timeframes to monitor
SYMBOLS=BTCUSDT,ETHUSDT,SOLUSDT
TIMEFRAMES=15m,1h

# Scoring thresholds
CONFLUENCE_THRESHOLD=4.5    # Minimum score for A+ signal
WATCHLIST_THRESHOLD=3.5     # Minimum score for B-grade watchlist

# Risk management
MIN_RISK_REWARD=2.0         # Minimum R:R to generate signal
TP1_RR=1.5                  # Take-profit 1 risk:reward ratio
TP2_RR=2.5                  # Take-profit 2
TP3_RR=4.0                  # Take-profit 3

# Strategy selection
STRATEGY=regime-adaptive    # Options: base, regime-adaptive

# Notifications (optional)
WEBHOOK_DISCORD_URL=https://discord.com/api/webhooks/...
WEBHOOK_TELEGRAM_BOT_TOKEN=your-bot-token
WEBHOOK_TELEGRAM_CHAT_ID=your-chat-id
```

## Available Strategies

| Strategy | Description |
|----------|-------------|
| `base` | Standard confluence scoring with external regime filtering |
| `regime-adaptive` | Switches between trend-following and mean-reversion based on detected market regime |
| `trend-following` | Pure trend-following with SMA alignment focus |
| `mean-reversion` | RSI extremes + structure-based entries |
| `fvg-sniper` | Prioritizes Fair Value Gap retests |
| `divergence-hunter` | RSI divergence-focused entries |
| `volume-breakout` | Volume spike + structure breakout |
| `quick-scalp` | Lower thresholds for faster entries |
| `conservative-confluence` | Higher thresholds, fewer but higher-quality signals |

## Project Structure

```
crypto-signal-engine/
├── src/
│   ├── index.js                 # Entry point, poll cycle orchestration
│   ├── config.js                # Central configuration
│   ├── indicators/              # RSI, FVG, Volume Profile, Volume, SMA Ribbon
│   ├── engine/
│   │   ├── confluenceScorer.js  # Base scoring engine
│   │   ├── strategyScorer.js    # Strategy-aware scorer
│   │   ├── signalGenerator.js   # Entry/SL/TP calculation
│   │   ├── signalTracker.js     # TP/SL hit detection
│   │   └── regimeDetector.js    # Market regime classification
│   ├── strategies/              # Pluggable strategy modules
│   ├── api/                     # REST API controllers + routes
│   ├── data/                    # Binance data fetcher
│   ├── db/                      # SQLite database + migrations
│   ├── realtime/                # Binance WebSocket client
│   └── notifications/           # Discord/Telegram formatters
├── frontend/
│   └── src/
│       ├── pages/               # Dashboard, Charts, History, Performance, ForwardTest, Settings
│       ├── components/          # SignalCard, ConfluenceMeter, IndicatorBadge
│       └── styles/              # Cyberpunk dark theme
├── tests/                       # Unit tests (21 tests, 4 files)
└── data/                        # SQLite DB (gitignored)
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Server status, poll count, config |
| `GET /api/dashboard` | Current indicator readings for all symbols |
| `GET /api/signals` | Signal history (filterable by symbol, grade, status) |
| `GET /api/signals/:id` | Single signal details |
| `GET /api/candles/:symbol/:interval` | Historical OHLCV data |
| `GET /api/stream/candles/:symbol/:interval` | SSE real-time candle stream |
| `GET /api/performance` | Win rate, profit factor, outcomes |
| `GET /api/forward-test/scores` | Forward test score log |
| `GET /api/forward-test/stats` | Aggregate scoring statistics |
| `GET /api/forward-test/timeline` | Poll-by-poll scoring timeline |
| `POST /api/poll` | Manually trigger a poll cycle |

## Tests

```bash
npm test
```

Runs 21 tests covering RSI calculation, swing detection, FVG detection, volume profile, and confluence grade classification.

## Backtesting

```bash
# Standard backtest
node src/backtest.js

# Walk-forward validation
node src/walkForward.js
```

Requires historical CSV data in `data/` (not included in repo — fetch with `node src/fetchHistoricalCsv.js`).

## License

ISC
