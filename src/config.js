require('dotenv').config();

const config = {
  symbols: (process.env.SYMBOLS || 'BTCUSDT,ETHUSDT,SOLUSDT').split(','),
  timeframes: (process.env.TIMEFRAMES || '15m').split(','),
  pollIntervalSeconds: parseInt(process.env.POLL_INTERVAL_SECONDS || '60', 10),
  candleHistoryLimit: parseInt(process.env.CANDLE_HISTORY_LIMIT || '500', 10),

  // Primary: Binance Vision data API (accessible from US), fallback: Binance.US
  binanceBaseUrl: process.env.BINANCE_BASE_URL || 'https://data-api.binance.vision/api/v3',
  binanceFallbackUrl: 'https://api.binance.us/api/v3',

  scoring: {
    confluenceThreshold: parseFloat(process.env.CONFLUENCE_THRESHOLD || '4.5'),
    watchlistThreshold: parseFloat(process.env.WATCHLIST_THRESHOLD || '3.5'),
    rsiPeriod: parseInt(process.env.RSI_PERIOD || '14', 10),
    rsiOversold: parseFloat(process.env.RSI_OVERSOLD || '30'),
    rsiOverbought: parseFloat(process.env.RSI_OVERBOUGHT || '70'),
    rsiNearOversold: parseFloat(process.env.RSI_NEAR_OVERSOLD || '40'),
    rsiNearOverbought: parseFloat(process.env.RSI_NEAR_OVERBOUGHT || '60'),
    rsiDivergenceLookback: parseInt(process.env.RSI_DIVERGENCE_LOOKBACK || '50', 10),
    rsiDivergenceSwingStrength: parseInt(process.env.RSI_DIVERGENCE_SWING_STRENGTH || '3', 10),
    fvgActiveLimit: parseInt(process.env.FVG_ACTIVE_LIMIT || '20', 10),
    volumeProfileLookback: parseInt(process.env.VOLUME_PROFILE_LOOKBACK || '100', 10),
    volumeProfileBins: parseInt(process.env.VOLUME_PROFILE_BINS || '50', 10),
    volumeAvgPeriod: parseInt(process.env.VOLUME_AVG_PERIOD || '20', 10),
    volumeSpikeMultiplier: parseFloat(process.env.VOLUME_SPIKE_MULTIPLIER || '1.5'),
    smaFast: parseInt(process.env.SMA_FAST || '50', 10),
    smaSlow: parseInt(process.env.SMA_SLOW || '100', 10),
    signalCooldownCandles: parseInt(process.env.SIGNAL_COOLDOWN_CANDLES || '4', 10),
    signalExpiryHours: parseInt(process.env.SIGNAL_EXPIRY_HOURS || '48', 10),
  },

  risk: {
    pocProximityPercent: parseFloat(process.env.POC_PROXIMITY_PERCENT || '0.5'),
  },

  // Per-symbol risk profiles (optimized via 5-year backtest)
  symbolProfiles: {
    BTCUSDT: {
      riskPct: 0.75,    // SL distance as % of entry
      tp1RR: 1.2,       // TP1 R-multiple
      tp2RR: 0,         // TP2 disabled
      tp3RR: 0,
      maxBars: 96,      // Candles before signal expires
      minRiskReward: 1.2,
      regimeFilter: {
        trending_bull: ['LONG', 'SHORT'],
        trending_bear: ['SHORT', 'LONG'],
        ranging: ['LONG', 'SHORT'],
      },
    },
    ETHUSDT: {
      riskPct: 1.5,
      tp1RR: 2.0,
      tp2RR: 0,
      tp3RR: 0,
      maxBars: 48,
      minRiskReward: 1.5,
      regimeFilter: {
        trending_bull: ['LONG', 'SHORT'],
        trending_bear: ['SHORT', 'LONG'],
        ranging: ['LONG', 'SHORT'],
      },
    },
    SOLUSDT: {
      riskPct: 0.5,
      tp1RR: 1.0,
      tp2RR: 2.0,
      tp3RR: 0,
      maxBars: 24,
      minRiskReward: 1.0,
      regimeFilter: {
        trending_bull: ['LONG', 'SHORT'],
        trending_bear: ['SHORT', 'LONG'],
        ranging: ['LONG', 'SHORT'],
      },
    },
  },

  // Default risk profile for symbols not in symbolProfiles
  defaultProfile: {
    riskPct: 1.0,
    tp1RR: 1.2,
    tp2RR: 0,
    tp3RR: 0,
    maxBars: 48,
    minRiskReward: 1.2,
    regimeFilter: {
      trending_bull: ['LONG', 'SHORT'],
      trending_bear: ['SHORT', 'LONG'],
      ranging: ['LONG', 'SHORT'],
    },
  },

  // Regime detection settings
  // Active strategy for live engine (matches strategy module name)
  activeStrategy: process.env.STRATEGY || 'base',

  regime: {
    htfInterval: '4h',
    htfCandleLimit: 150,        // Candles to fetch for HTF analysis
    rangingThresholdPct: 1.5,   // SMA spread below this = ranging
  },

  webhooks: {
    discordUrl: process.env.WEBHOOK_DISCORD_URL || '',
    telegramBotToken: process.env.WEBHOOK_TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.WEBHOOK_TELEGRAM_CHAT_ID || '',
  },

  server: {
    port: parseInt(process.env.PORT || '3002', 10),
    frontendPort: parseInt(process.env.FRONTEND_PORT || '5173', 10),
  },

  dbPath: process.env.DB_PATH || './data/signals.db',
};

config.getSymbolProfile = function (symbol) {
  return config.symbolProfiles[symbol] || config.defaultProfile;
};

module.exports = config;
