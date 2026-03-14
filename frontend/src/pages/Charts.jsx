import { useState, useEffect, useRef, useCallback } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
} from 'lightweight-charts';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const INTERVALS = ['1m', '5m', '15m', '1h', '4h'];
const SYMBOL_LABELS = { BTCUSDT: 'BTC', ETHUSDT: 'ETH', SOLUSDT: 'SOL' };

// Intervals that have historical data in the DB
const DB_INTERVALS = new Set(['15m', '1h']);

export default function Charts() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval_] = useState('15m');
  const [indicators, setIndicators] = useState(null);
  const [loading, setLoading] = useState(true);
  const [streamStatus, setStreamStatus] = useState('disconnected');

  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const sma50SeriesRef = useRef(null);
  const sma100SeriesRef = useRef(null);
  const candleDataRef = useRef([]);

  // Create chart once on mount
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 500,
      layout: {
        background: { type: ColorType.Solid, color: '#16161f' },
        textColor: '#8888a0',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#2a2a3a' },
        horzLines: { color: '#2a2a3a' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#aa66ff80', labelBackgroundColor: '#aa66ff' },
        horzLine: { color: '#aa66ff80', labelBackgroundColor: '#aa66ff' },
      },
      rightPriceScale: {
        borderColor: '#2a2a3a',
        scaleMargins: { top: 0.05, bottom: 0.2 },
      },
      timeScale: {
        borderColor: '#2a2a3a',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00ff88',
      downColor: '#ff4466',
      borderUpColor: '#00ff88',
      borderDownColor: '#ff4466',
      wickUpColor: '#00ff8880',
      wickDownColor: '#ff446680',
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    const sma50Series = chart.addSeries(LineSeries, {
      color: '#00ccff',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    const sma100Series = chart.addSeries(LineSeries, {
      color: '#aa66ff',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    sma50SeriesRef.current = sma50Series;
    sma100SeriesRef.current = sma100Series;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: 500,
        });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // Compute SMA from candle array
  const computeSMA = useCallback((candles, period) => {
    const result = [];
    for (let i = period - 1; i < candles.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
      result.push({ time: candles[i].time, value: sum / period });
    }
    return result;
  }, []);

  // Recompute and push SMAs to chart
  const updateSMAs = useCallback((candles) => {
    if (!sma50SeriesRef.current) return;
    sma50SeriesRef.current.setData(computeSMA(candles, 50));
    sma100SeriesRef.current.setData(computeSMA(candles, 100));
  }, [computeSMA]);

  // Load historical data + connect SSE stream
  useEffect(() => {
    let cancelled = false;
    let eventSource = null;
    setLoading(true);
    setStreamStatus('connecting');

    async function init() {
      try {
        // Fetch historical candles from DB (only for intervals we store)
        const fetches = [fetch('/api/dashboard')];
        if (DB_INTERVALS.has(interval)) {
          fetches.unshift(fetch(`/api/candles/${symbol}/${interval}?limit=500`));
        }

        const responses = await Promise.all(fetches);
        if (cancelled) return;

        let candles = [];
        let dashIdx = 0;

        if (DB_INTERVALS.has(interval)) {
          const candleJson = await responses[0].json();
          candles = candleJson.candles || [];
          dashIdx = 1;
        }

        const dashboard = await responses[dashIdx].json();
        if (cancelled || !chartRef.current) return;

        // Set historical data
        candleDataRef.current = candles;
        candleSeriesRef.current.setData(candles);
        volumeSeriesRef.current.setData(
          candles.map(c => ({
            time: c.time,
            value: c.volume,
            color: c.close >= c.open ? '#00ff8830' : '#ff446630',
          }))
        );
        updateSMAs(candles);
        chartRef.current.timeScale().fitContent();

        // Set indicator readings
        const dashData = dashboard[symbol]?.[interval];
        if (dashData) setIndicators(dashData);
      } catch (err) {
        console.error('Chart data fetch failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }

      // Connect to real-time SSE stream
      if (cancelled) return;

      eventSource = new EventSource(`/api/stream/candles/${symbol}/${interval}`);

      eventSource.onopen = () => {
        if (!cancelled) setStreamStatus('live');
      };

      eventSource.onmessage = (event) => {
        if (cancelled || !chartRef.current) return;

        const candle = JSON.parse(event.data);
        const point = {
          time: candle.time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        };

        // Update or append candle in our data array
        const data = candleDataRef.current;
        if (data.length > 0 && data[data.length - 1].time === candle.time) {
          data[data.length - 1] = { ...point, volume: candle.volume };
        } else {
          data.push({ ...point, volume: candle.volume });
          if (data.length > 600) data.shift();
        }

        // Push update to chart
        candleSeriesRef.current.update(point);
        volumeSeriesRef.current.update({
          time: candle.time,
          value: candle.volume,
          color: candle.close >= candle.open ? '#00ff8830' : '#ff446630',
        });

        // Recompute SMAs on closed candles
        if (candle.isClosed) {
          updateSMAs(data);
        }
      };

      eventSource.onerror = () => {
        if (!cancelled) setStreamStatus('reconnecting');
      };
    }

    init();

    return () => {
      cancelled = true;
      if (eventSource) {
        eventSource.close();
      }
      setStreamStatus('disconnected');
    };
  }, [symbol, interval, updateSMAs]);

  return (
    <div>
      <div className="page-header">
        <h2>Charts</h2>
        <div className="subtitle">
          Real-time candlestick charts with SMA overlay
          <span className={`stream-badge ${streamStatus}`}>
            {streamStatus === 'live' ? 'LIVE' : streamStatus === 'reconnecting' ? 'RECONNECTING' : 'CONNECTING'}
          </span>
        </div>
      </div>

      <div className="chart-controls">
        <div className="asset-selector">
          {SYMBOLS.map(s => (
            <button
              key={s}
              className={`asset-btn ${s === symbol ? 'active' : ''}`}
              onClick={() => setSymbol(s)}
            >
              {SYMBOL_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="asset-selector">
          {INTERVALS.map(tf => (
            <button
              key={tf}
              className={`asset-btn ${tf === interval ? 'active' : ''}`}
              onClick={() => setInterval_(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {indicators && (
        <div className="chart-indicators">
          <div className="chart-indicator-item">
            <span className="chart-indicator-label">RSI</span>
            <span className={`chart-indicator-value ${
              indicators.rsiCondition === 'oversold' || indicators.rsiCondition === 'near_oversold'
                ? 'green' : indicators.rsiCondition === 'overbought' || indicators.rsiCondition === 'near_overbought'
                ? 'red' : ''
            }`}>{indicators.rsi ?? '—'}</span>
          </div>
          <div className="chart-indicator-item">
            <span className="chart-indicator-label">SMA</span>
            <span className={`chart-indicator-value ${
              indicators.smaAlignment === 'bullish' ? 'green'
                : indicators.smaAlignment === 'bearish' ? 'red' : ''
            }`}>{indicators.smaAlignment ?? '—'}</span>
          </div>
          <div className="chart-indicator-item">
            <span className="chart-indicator-label">Vol Ratio</span>
            <span className={`chart-indicator-value ${indicators.volumeSpike ? 'green' : ''}`}>
              {indicators.volumeRatio ?? '—'}x
            </span>
          </div>
          <div className="chart-indicator-item">
            <span className="chart-indicator-label">FVGs</span>
            <span className="chart-indicator-value">{indicators.activeFvgs ?? 0}</span>
          </div>
          <div className="chart-indicator-item">
            <span className="chart-indicator-label">POC</span>
            <span className="chart-indicator-value">{indicators.poc?.toLocaleString() ?? '—'}</span>
          </div>
        </div>
      )}

      <div className="chart-legend">
        <span className="legend-item"><span className="legend-line cyan" />SMA 50</span>
        <span className="legend-item"><span className="legend-line purple" />SMA 100</span>
      </div>

      <div className="chart-wrapper card">
        {loading && <div className="chart-loading">Loading chart...</div>}
        <div ref={chartContainerRef} className="chart-container" />
      </div>
    </div>
  );
}
