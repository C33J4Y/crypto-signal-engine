# CryptoSignal Engine — Usage Manual

## Quick Start

```bash
# 1. Install dependencies
npm install
cd frontend && npm install && cd ..

# 2. Start the backend (fetches data + runs signal engine)
node src/index.js

# 3. Start the frontend (separate terminal)
cd frontend && npm run dev
```

- Backend: http://localhost:3002
- Frontend: http://localhost:5173
- Health check: http://localhost:3002/api/health

---

## How It Works

The engine runs a continuous loop every 60 seconds:

1. **Fetch** — Pulls the latest 500 candles for BTC, ETH, SOL on 15m from Binance
2. **Score** — Runs 6 indicators on each symbol and computes a confluence score (0–10)
3. **Signal** — If the score hits 6.0+ (A+ grade), generates a signal with entry, stop-loss, and take-profit levels
4. **Track** — Monitors active signals to detect when TP or SL levels are hit
5. **Notify** — Sends alerts to configured Discord/Telegram webhooks

### Confluence Scoring (Max 10 Points)

| Indicator | Condition (Long) | Points |
|-----------|-------------------|--------|
| RSI State | RSI(14) ≤ 35 | +1.5 |
| RSI Divergence | Bullish divergence | +2.0 |
| Fair Value Gap | Price in bullish FVG zone | +2.0 |
| Volume Profile POC | Price within 0.3% of POC | +1.5 |
| Volume Spike | Volume ≥ 2x 20-period avg | +1.0 |
| SMA Ribbon Trend | 50 SMA > 100 SMA, price above both | +1.5 |
| SMA Ribbon Touch | Pullback to 50 SMA | +0.5 |

Short signals use the mirror conditions (RSI ≥ 65, bearish FVG, etc.).

### Signal Grades

| Score | Grade | Action |
|-------|-------|--------|
| 7.0–10.0 | A+ | Alert sent — high-confluence setup |
| 5.0–6.5 | B | Logged to watchlist |
| < 5.0 | C | Discarded |

---

## Backtesting

Test the strategy against historical data already in your database:

```bash
# Full backtest with default A+ threshold (7.0)
node src/backtest.js

# Lower threshold to see more signals
node src/backtest.js --threshold 5

# Single symbol
node src/backtest.js --symbol BTCUSDT --threshold 5

# Single timeframe
node src/backtest.js --interval 1h --threshold 5

# Last 3 days only
node src/backtest.js --days 3 --threshold 5

# Verbose mode — shows every candle's score
node src/backtest.js --threshold 4 --verbose
```

The backtester outputs:
- Total signals found
- Win/Loss/Expired counts
- Win rate percentage
- Total and average R (risk multiples)
- Per-symbol and per-direction breakdowns
- Full signal detail table with entry prices, indicators fired, and outcomes

**Note:** The backtester uses data already fetched and stored in SQLite. To get more data, let the engine run for longer or increase `CANDLE_HISTORY_LIMIT` in `.env`.

---

## Frontend Pages

### Dashboard
Live overview of all 3 assets showing:
- Current price and 24h change
- RSI value with color coding (green = oversold, red = overbought)
- SMA alignment (bullish/bearish/neutral)
- Volume ratio (highlighted when spike detected)
- Active FVG count
- POC and SMA50 levels

Active A+ signals appear below with full entry/SL/TP details and indicator badges.

### Signal History
Table of all generated signals with:
- Timestamp, symbol, timeframe, direction
- Confluence score and grade
- Entry, stop-loss, TP2 levels
- Risk:Reward ratio
- Current status (active, tp1_hit, tp2_hit, tp3_hit, stopped_out, expired)
- P&L percentage

### Performance
Aggregate metrics:
- Total signals, wins, losses
- Win rate and average P&L
- Breakdowns by asset and timeframe

### Settings
- System status (uptime, poll count, interval)
- Manual poll trigger button
- Webhook configuration (add Discord/Telegram URLs)

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | System status, candle counts, config |
| GET | `/api/dashboard` | Live indicator readings for all assets |
| GET | `/api/signals` | List signals (filter: `?symbol=`, `?status=`, `?grade=`, `?limit=`) |
| GET | `/api/signals/:id` | Single signal detail with full indicator breakdown |
| GET | `/api/performance` | Win rate, P&L, breakdowns |
| POST | `/api/poll` | Trigger manual data fetch + scoring cycle |
| GET | `/api/config/webhooks` | List webhook configurations |
| POST | `/api/config/webhooks` | Add/update a webhook |

---

## Webhook Setup

### Discord
1. In your Discord server, go to Channel Settings > Integrations > Webhooks
2. Create a new webhook and copy the URL
3. Either add it via the Settings page in the UI, or set `WEBHOOK_DISCORD_URL` in `.env`

### Telegram
1. Create a bot via @BotFather and get the bot token
2. Get your chat ID (send a message to the bot, then check `https://api.telegram.org/bot<TOKEN>/getUpdates`)
3. Set `WEBHOOK_TELEGRAM_BOT_TOKEN` and `WEBHOOK_TELEGRAM_CHAT_ID` in `.env`

---

## Configuration

All settings are in `.env` (copy from `.env.example`):

### Key Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `SYMBOLS` | BTCUSDT,ETHUSDT,SOLUSDT | Tracked trading pairs |
| `TIMEFRAMES` | 15m | Candle timeframe |
| `POLL_INTERVAL_SECONDS` | 60 | How often to fetch new data |
| `CONFLUENCE_THRESHOLD` | 6.0 | Minimum score for A+ signal |
| `RSI_OVERSOLD` | 35 | RSI level for oversold scoring |
| `RSI_OVERBOUGHT` | 65 | RSI level for overbought scoring |
| `VOLUME_SPIKE_MULTIPLIER` | 2.0 | Volume must be Nx average |
| `SIGNAL_COOLDOWN_CANDLES` | 4 | Min candles between same signals |
| `SIGNAL_EXPIRY_HOURS` | 48 | Auto-expire active signals |
| `MIN_RISK_REWARD` | 2.0 | Minimum R:R to emit signal |
| `TP1_RR` / `TP2_RR` / `TP3_RR` | 1.5 / 2.5 / 4.0 | Take-profit R:R ratios |

---

## Troubleshooting

**"Backend unavailable" in frontend**
- Make sure `node src/index.js` is running in a separate terminal
- Check http://localhost:3002/api/health

**No signals generated**
- A+ signals require score ≥ 7.0 which needs multiple indicators aligning — this is by design
- Run the backtester with `--threshold 5` to see B-grade setups
- Check the dashboard for current indicator readings

**Binance API errors (451)**
- The engine auto-falls back to `data-api.binance.vision` which works from the US
- If both fail, check your internet connection

**Database errors**
- Delete `data/signals.db` and restart — migrations will recreate all tables

---

## Important Notes

- **No auto-trading.** This system generates signals only. You decide whether to enter trades.
- **Educational tool.** Past performance does not guarantee future results.
- **Rate limits.** The engine uses ~16 API weight per poll cycle (well within Binance's 1200/min limit).
