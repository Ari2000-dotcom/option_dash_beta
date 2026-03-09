import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
  type LogicalRange,
} from 'lightweight-charts';
import type { NubraInstrument } from './useNubraInstruments';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StrategyLeg {
  symbol: string;
  expiry: string;
  strike: number;
  type: 'CE' | 'PE';
  refId?: number;
  lotSize: number;
}

interface StrategyChartProps {
  legs: StrategyLeg[];
  ocSymbol: string;
  ocExchange: string;
  nubraInstruments: NubraInstrument[];
  nubraIndexes: Record<string, string>[];
}

interface SeriesSet {
  underlying: ISeriesApi<'Line'> | null;
  options: Map<string, ISeriesApi<'Line'>>;
  deltas:  Map<string, ISeriesApi<'Line'>>;
  ivs:     Map<string, ISeriesApi<'Line'>>;
}

interface AccumData {
  underlying: LineData[];
  options: Map<string, LineData[]>;
  deltas:  Map<string, LineData[]>;
  ivs:     Map<string, LineData[]>;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function prevTradingDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  do { d.setUTCDate(d.getUTCDate() - 1); }
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return toDateStr(d);
}

function lastTradingDay(): string {
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  const day = now.getUTCDay();
  if (day === 0) now.setUTCDate(now.getUTCDate() - 2);
  else if (day === 6) now.setUTCDate(now.getUTCDate() - 1);
  return now.toISOString().slice(0, 10);
}

function formatDate(d: string): string {
  // YYYY-MM-DD → DD MMM
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [, m, day] = d.split('-');
  return `${parseInt(day)} ${months[parseInt(m) - 1]}`;
}

// ── Nubra helpers ─────────────────────────────────────────────────────────────

function nsToTime(ns: number): Time {
  return Math.round(ns / 1e9) as unknown as Time;
}
const getTs  = (p: any): number => p?.ts ?? p?.timestamp ?? 0;
const getVal = (p: any): number => p?.v  ?? p?.value     ?? 0;

function sortDedup(pts: LineData[]): LineData[] {
  pts.sort((a, b) => (a.time as number) - (b.time as number));
  const out: LineData[] = [];
  const seen = new Set<number>();
  for (const pt of pts) {
    const t = pt.time as number;
    if (!seen.has(t)) { seen.add(t); out.push(pt); }
  }
  return out;
}

function mergeData(older: LineData[], newer: LineData[]): LineData[] {
  return sortDedup([...older, ...newer]);
}

async function nubraPost(body: object): Promise<any> {
  const sessionToken = localStorage.getItem('nubra_session_token') ?? '';
  const authToken    = localStorage.getItem('nubra_auth_token')    ?? '';
  const deviceId     = localStorage.getItem('nubra_device_id')     ?? '';
  const res = await fetch('/api/nubra-historical', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_token: sessionToken, auth_token: authToken, device_id: deviceId, ...body }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  const resultArr = json.result ?? [];
  if (!resultArr.length) throw new Error(json.message ?? `No result. Keys: ${Object.keys(json).join(',')}`);
  const valuesArr = resultArr[0]?.values ?? [];
  let stockChart: any = null;
  for (const dict of valuesArr) {
    for (const [, v] of Object.entries(dict)) { stockChart = v; break; }
    if (stockChart) break;
  }
  if (!stockChart) throw new Error(`No chart data. valuesArr len=${valuesArr.length}`);
  return stockChart;
}

// Build Nubra date params: today → intraDay:true, historical → explicit range
function buildDateParams(date: string, today: string) {
  const isToday = date === today;
  return {
    startDate: isToday ? '' : `${date}T03:45:00.000Z`,
    endDate:   isToday ? '' : `${date}T11:30:00.000Z`,
    intraDay:  isToday,
  };
}

// Fetch underlying close for a date via Nubra (INDEX or STOCK type)
async function fetchUnderlyingForDate(
  nubraSymbol: string,
  exchange: string,
  nubraType: string,
  date: string,
  today: string,
): Promise<LineData[]> {
  const { startDate, endDate, intraDay } = buildDateParams(date, today);
  console.log('[StrategyChart] fetchUnderlying', { nubraSymbol, nubraType, exchange, date, intraDay });
  const chart = await nubraPost({
    exchange, type: nubraType, values: [nubraSymbol], fields: ['close'],
    startDate, endDate, interval: '1m', intraDay,
  });
  const toLine = (arr: any[]): LineData[] =>
    sortDedup((arr ?? []).filter((p: any) => getTs(p)).map((p: any) => ({
      time: nsToTime(getTs(p)),
      value: getVal(p) / 100,
    })));
  return toLine(chart.close ?? []);
}

// Fetch option close + delta + iv_mid in one call
async function fetchOptionForDate(
  symbol: string,
  exchange: string,
  date: string,
  today: string,
): Promise<{ close: LineData[]; delta: LineData[]; iv: LineData[] }> {
  const { startDate, endDate, intraDay } = buildDateParams(date, today);
  const chart = await nubraPost({
    exchange, type: 'OPT', values: [symbol], fields: ['close', 'delta', 'iv_mid'],
    startDate, endDate, interval: '1m', intraDay,
  });
  const toLine = (arr: any[], scale = 1): LineData[] =>
    sortDedup((arr ?? []).filter((p: any) => getTs(p)).map((p: any) => ({
      time: nsToTime(getTs(p)),
      value: getVal(p) * scale,
    })));
  return {
    close: toLine(chart.close ?? [], 1 / 100),
    delta: toLine(chart.delta ?? []),
    iv:    toLine(chart.iv_mid ?? [], 100),
  };
}

const INITIAL_VISIBLE = 120;

// ── Colors ────────────────────────────────────────────────────────────────────

const UNDERLYING_COLOR = '#60a5fa';
const CE_COLORS    = ['#2ebd85', '#4ade80', '#86efac', '#a3e635'];
const PE_COLORS    = ['#f23645', '#fb923c', '#f472b6', '#e879f9'];
const DELTA_COLORS = ['#f59e0b', '#fbbf24', '#fcd34d'];
const IV_COLORS    = ['#a78bfa', '#c4b5fd', '#ddd6fe'];

function optionColor(type: 'CE' | 'PE', idx: number) {
  return type === 'CE' ? CE_COLORS[idx % CE_COLORS.length] : PE_COLORS[idx % PE_COLORS.length];
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function StrategyChart({ legs, ocSymbol, ocExchange, nubraInstruments, nubraIndexes }: StrategyChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<SeriesSet>({
    underlying: null, options: new Map(), deltas: new Map(), ivs: new Map(),
  });
  const fetchAllRef = useRef<() => void>(() => {});

  const accumRef = useRef<AccumData>({
    underlying: [], options: new Map(), deltas: new Map(), ivs: new Map(),
  });

  // Oldest date loaded so far — scroll-back steps this back one day at a time
  const oldestDateRef    = useRef<string | null>(null);
  const isLoadingMoreRef = useRef(false);
  const loadLockRef      = useRef(false);
  const loadedDatesRef   = useRef<Set<string>>(new Set());

  const [loading,     setLoading]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,       setError]       = useState('');
  const [legendItems, setLegendItems] = useState<{ label: string; color: string }[]>([]);
  const [chartReady,  setChartReady]  = useState(false);
  // Date range shown in header — updates as user scrolls back
  const [fromDate, setFromDate] = useState<string | null>(null);
  const [toDate,   setToDate]   = useState<string | null>(null);

  const uniqueLegs = legs.filter((leg, i, arr) =>
    arr.findIndex(l => l.strike === leg.strike && l.type === leg.type) === i
  );

  // ── Resolve underlying Nubra symbol + type ───────────────────────────────────
  // Returns { symbol, exchange, nubraType } where nubraType is 'INDEX' or 'STOCK'
  const resolveUnderlying = useCallback((): { symbol: string; exchange: string; nubraType: string } | null => {
    if (!ocSymbol) return null;
    const sym = ocSymbol.toUpperCase();
    const exch = (ocExchange || 'NSE').toUpperCase();

    // 0. Derive from option legs' own nubraInstrument entry — the `asset` field
    //    is exactly what Nubra uses as the index symbol for that option (e.g. "SENSEX", "NIFTY 50")
    //    Try both INDEX and STOCK types by checking derivative_type of a matching instrument.
    if (nubraInstruments.length) {
      const optIns = nubraInstruments.find(i =>
        (i.option_type === 'CE' || i.option_type === 'PE') &&
        ((i.asset ?? '').toUpperCase() === sym ||
         (i.nubra_name ?? '').toUpperCase() === sym ||
         (i.stock_name ?? '').toUpperCase().startsWith(sym))
      );
      if (optIns?.asset) {
        const nubraType = (optIns.asset_type ?? '').includes('INDEX') ? 'INDEX' : 'STOCK';
        console.log('[StrategyChart] resolved underlying from option asset:', optIns.asset, nubraType);
        return { symbol: optIns.asset, exchange: optIns.exchange || exch, nubraType };
      }
    }

    // 1. Try nubraIndexes (INDEX type) — for both NSE and BSE indexes
    if (nubraIndexes.length) {
      const score = (i: Record<string, string>): number => {
        const nm  = (i.INDEX_NAME ?? i.index_name ?? '').toUpperCase().trim();
        const exf = (i.EXCHANGE   ?? i.exchange   ?? '').toUpperCase();
        // Bonus for matching exchange
        const exchBonus = exf === exch ? 10 : 0;
        if (nm === sym) return 1000 + exchBonus;
        if (nm === sym + ' 50') return 900 + exchBonus;
        if (nm.startsWith(sym + ' ') && nm.split(' ').length === 2) return 800 + exchBonus;
        if (nm.startsWith(sym + ' ')) return 500 - nm.length + exchBonus;
        // Word contained anywhere (e.g. "S&P BSE SENSEX" contains "SENSEX")
        const words = nm.split(/[\s&]+/);
        if (words.includes(sym)) return 400 + exchBonus;
        return -1;
      };
      let best: Record<string, string> | null = null;
      let bestScore = -1;
      for (const i of nubraIndexes) {
        const s = score(i);
        if (s > bestScore) { bestScore = s; best = i; }
      }
      if (best && bestScore >= 0) {
        const symbol   = best.ZANSKAR_INDEX_SYMBOL ?? best.zanskar_index_symbol ?? best.INDEX_SYMBOL ?? best.index_symbol ?? '';
        const exchange = best.EXCHANGE ?? best.exchange ?? exch;
        if (symbol) {
          console.log('[StrategyChart] resolved underlying as INDEX:', symbol, exchange);
          return { symbol, exchange, nubraType: 'INDEX' };
        }
      }
    }

    // 2. Fall back to nubraInstruments — find a plain STOCK (derivative_type='STOCK')
    // Prefer matching exchange, then any exchange
    if (nubraInstruments.length) {
      const matches = nubraInstruments.filter(i =>
        i.derivative_type === 'STOCK' &&
        ((i.asset ?? '').toUpperCase() === sym ||
         (i.stock_name ?? '').toUpperCase() === sym ||
         (i.nubra_name ?? '').toUpperCase() === sym)
      );
      // Prefer correct exchange, fall back to first match
      const ins = matches.find(i => (i.exchange ?? '').toUpperCase() === exch) ?? matches[0];
      if (ins) {
        const symbol   = ins.stock_name || ins.nubra_name || ins.asset;
        const exchange = ins.exchange || exch;
        console.log('[StrategyChart] resolved underlying as STOCK:', symbol, exchange);
        return { symbol, exchange, nubraType: 'STOCK' };
      }
    }

    console.warn('[StrategyChart] could not resolve underlying for', sym, exch);
    return null;
  }, [ocSymbol, ocExchange, nubraIndexes, nubraInstruments]);

  // ── Resolve option symbol from nubraInstruments ───────────────────────────────
  const resolveOption = useCallback((leg: StrategyLeg): { symbol: string; exchange: string } | null => {
    const sym = ocSymbol.toUpperCase();
    if (leg.refId) {
      const ins = nubraInstruments.find(i => String(i.ref_id) === String(leg.refId));
      if (ins) return { symbol: ins.stock_name || ins.nubra_name, exchange: ins.exchange || 'NSE' };
    }
    const strikePaise = Math.round(leg.strike * 100);
    const ins = nubraInstruments.find(i =>
      i.option_type === leg.type &&
      String(i.expiry) === String(leg.expiry) &&
      Math.abs((i.strike_price ?? 0) - strikePaise) < 2 &&
      ((i.asset      ?? '').toUpperCase() === sym ||
       (i.nubra_name ?? '').toUpperCase() === sym ||
       (i.stock_name ?? '').toUpperCase().startsWith(sym))
    );
    if (ins) return { symbol: ins.stock_name || ins.nubra_name, exchange: ins.exchange || 'NSE' };
    return null;
  }, [ocSymbol, nubraInstruments]);

  // ── Init chart ONCE on mount ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: '#171717' },
        textColor: '#787B86',
        fontSize: 11,
        fontFamily: "'Fira Code', monospace",
        panes: {
          separatorColor:      'rgba(255,255,255,0.08)',
          separatorHoverColor: 'rgba(255,255,255,0.20)',
          enableResize: true,
        },
      },
      grid:      { vertLines: { color: '#222' }, horzLines: { color: '#222' } },
      crosshair: { mode: 0 },
      leftPriceScale:  { visible: true, borderColor: '#2a2a2a', scaleMargins: { top: 0.06, bottom: 0.06 } },
      rightPriceScale: { borderColor: '#2a2a2a', scaleMargins: { top: 0.06, bottom: 0.06 } },
      timeScale: {
        borderColor: '#2a2a2a', timeVisible: true, secondsVisible: false,
        tickMarkFormatter: (ts: number) =>
          new Date(ts * 1000).toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
          }),
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale:  { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    });
    chartRef.current = chart;
    setChartReady(true);
    return () => {
      chart.remove();
      chartRef.current = null;
      setChartReady(false);
      seriesRef.current = { underlying: null, options: new Map(), deltas: new Map(), ivs: new Map() };
    };
  }, []);

  // ── Sync series whenever legs / symbol change ─────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const ss = seriesRef.current;
    const newLegKeys = new Set(uniqueLegs.map(l => `${l.strike}${l.type}`));

    for (const [key, s] of ss.options) {
      if (!newLegKeys.has(key)) { try { chart.removeSeries(s); } catch { /**/ } ss.options.delete(key); }
    }
    for (const [key, s] of ss.deltas) {
      if (!newLegKeys.has(key)) { try { chart.removeSeries(s); } catch { /**/ } ss.deltas.delete(key); }
    }
    for (const [key, s] of ss.ivs) {
      if (!newLegKeys.has(key)) { try { chart.removeSeries(s); } catch { /**/ } ss.ivs.delete(key); }
    }

    if (!ss.underlying) {
      // Underlying on LEFT axis — its large absolute values won't crush option prices
      ss.underlying = chart.addSeries(LineSeries, {
        color: UNDERLYING_COLOR, lineWidth: 2, title: ocSymbol,
        priceFormat: { type: 'price', precision: 2, minMove: 0.05 },
        priceScaleId: 'left',
      }, 0);
      chart.priceScale('left').applyOptions({ scaleMargins: { top: 0.06, bottom: 0.06 } });
    }

    let ceCount = 0, peCount = 0;
    for (const leg of uniqueLegs) {
      const key = `${leg.strike}${leg.type}`;
      const colorIdx = leg.type === 'CE' ? ceCount++ : peCount++;
      const color = optionColor(leg.type, colorIdx);

      if (!ss.options.has(key)) {
        // Options on RIGHT axis — their LTP values are independent of underlying
        ss.options.set(key, chart.addSeries(LineSeries, {
          color, lineWidth: 1.5, title: `${leg.strike}${leg.type}`,
          priceFormat: { type: 'price', precision: 2, minMove: 0.05 },
          priceScaleId: 'right',
        }, 0));
      }
      if (!ss.deltas.has(key)) {
        ss.deltas.set(key, chart.addSeries(LineSeries, {
          color: leg.type === 'CE' ? DELTA_COLORS[colorIdx % DELTA_COLORS.length] : PE_COLORS[colorIdx % PE_COLORS.length],
          lineWidth: 1.5, title: `Δ ${leg.strike}${leg.type}`,
          priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
        }, 1));
        try { chart.panes()[1]?.setHeight(110); } catch { /**/ }
      }
      if (!ss.ivs.has(key)) {
        ss.ivs.set(key, chart.addSeries(LineSeries, {
          color: IV_COLORS[colorIdx % IV_COLORS.length],
          lineWidth: 1.5, title: `IV ${leg.strike}${leg.type}`,
          priceFormat: { type: 'percent', precision: 2, minMove: 0.01 },
        }, 2));
        try { chart.panes()[2]?.setHeight(90); } catch { /**/ }
      }
    }

    const items: { label: string; color: string }[] = [{ label: ocSymbol, color: UNDERLYING_COLOR }];
    let ci = 0, pi = 0;
    for (const leg of uniqueLegs) {
      if (leg.type === 'CE') items.push({ label: `${leg.strike} CE`, color: CE_COLORS[ci++ % CE_COLORS.length] });
      else                   items.push({ label: `${leg.strike} PE`, color: PE_COLORS[pi++ % PE_COLORS.length] });
    }
    setLegendItems(items);
  }, [ocSymbol, uniqueLegs.map(l => `${l.strike}${l.type}`).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Push accum into chart series ──────────────────────────────────────────────
  const flushAccum = useCallback((prepend = false) => {
    const chart = chartRef.current;
    const ss    = seriesRef.current;
    const acc   = accumRef.current;
    const ts    = chart?.timeScale();

    const savedRange  = prepend ? ts?.getVisibleLogicalRange() : null;
    const snapUnderly = acc.underlying.slice();
    const snapOptions = new Map(acc.options);
    const snapDeltas  = new Map(acc.deltas);
    const snapIvs     = new Map(acc.ivs);

    requestAnimationFrame(() => {
      if (ss.underlying && snapUnderly.length) ss.underlying.setData(snapUnderly);
      for (const [key, data] of snapOptions) ss.options.get(key)?.setData(data);
      for (const [key, data] of snapDeltas)  ss.deltas.get(key)?.setData(data);
      for (const [key, data] of snapIvs)     ss.ivs.get(key)?.setData(data);

      if (prepend && savedRange && ts) {
        ts.setVisibleLogicalRange(savedRange);
      } else if (!prepend && ts) {
        // Scroll to right edge showing last INITIAL_VISIBLE bars
        const refData = snapUnderly.length ? snapUnderly
          : (snapOptions.values().next().value ?? []);
        if (refData.length > 0) {
          const visible = Math.min(INITIAL_VISIBLE, refData.length);
          const from = refData[refData.length - visible].time;
          const to   = refData[refData.length - 1].time;
          setTimeout(() => ts.setVisibleRange({ from, to }), 50);
        } else {
          chart?.timeScale().fitContent();
        }
      }
    });
  }, []);

  // ── Fetch one trading day into accumulator ────────────────────────────────────
  // Returns true if any data came back
  const fetchDay = useCallback(async (
    date: string,
    today: string,
    underlying: { symbol: string; exchange: string; nubraType: string } | null,
    legInfos: { key: string; symbol: string; exchange: string }[],
    prepend: boolean,
  ): Promise<boolean> => {
    if (loadedDatesRef.current.has(date)) return true;
    loadedDatesRef.current.add(date);

    let gotAny = false;
    const acc = accumRef.current;

    await Promise.all([
      // Underlying via Nubra (INDEX or STOCK)
      underlying
        ? fetchUnderlyingForDate(underlying.symbol, underlying.exchange, underlying.nubraType, date, today)
            .then(data => {
              if (data.length) {
                gotAny = true;
                acc.underlying = prepend ? mergeData(data, acc.underlying) : mergeData(acc.underlying, data);
              }
            })
            .catch((e: any) => console.warn('[StrategyChart] underlying failed:', date, e.message))
        : Promise.resolve(),

      // Each option: close + delta + iv
      ...legInfos.map(({ key, symbol, exchange }) =>
        fetchOptionForDate(symbol, exchange, date, today)
          .then(({ close, delta, iv }) => {
            if (close.length) {
              gotAny = true;
              const prev = acc.options.get(key) ?? [];
              acc.options.set(key, prepend ? mergeData(close, prev) : mergeData(prev, close));
            }
            if (delta.length) {
              const prev = acc.deltas.get(key) ?? [];
              acc.deltas.set(key, prepend ? mergeData(delta, prev) : mergeData(prev, delta));
            }
            if (iv.length) {
              const prev = acc.ivs.get(key) ?? [];
              acc.ivs.set(key, prepend ? mergeData(iv, prev) : mergeData(prev, iv));
            }
          })
          .catch((e: any) => console.warn('[StrategyChart] option failed', symbol, date, e.message))
      ),
    ]);

    return gotAny;
  }, []);

  // ── Initial load: today only via Nubra ───────────────────────────────────────
  const fetchAll = useCallback(async () => {
    if (!ocSymbol || uniqueLegs.length === 0 || !chartRef.current) return;
    setLoading(true);
    setError('');
    setFromDate(null);
    setToDate(null);

    accumRef.current = { underlying: [], options: new Map(), deltas: new Map(), ivs: new Map() };
    loadedDatesRef.current   = new Set();
    oldestDateRef.current    = null;
    isLoadingMoreRef.current = false;
    loadLockRef.current      = false;

    const underlying = resolveUnderlying();
    console.log('[StrategyChart] resolveUnderlying →', underlying, '| ocSymbol=', ocSymbol, '| nubraIndexes.length=', nubraIndexes.length);
    const legInfos: { key: string; symbol: string; exchange: string }[] = [];
    const errors: string[] = [];

    for (const leg of uniqueLegs) {
      const info = resolveOption(leg);
      if (!info) { errors.push(`no symbol for ${leg.strike}${leg.type}`); continue; }
      legInfos.push({ key: `${leg.strike}${leg.type}`, ...info });
    }

    try {
      const today = lastTradingDay();
      const got = await fetchDay(today, today, underlying, legInfos, false);
      if (got) {
        oldestDateRef.current = today;
        setFromDate(today);
        setToDate(today);
        flushAccum(false);
      } else {
        errors.push('No data for today — market may not have opened yet');
      }
    } catch (e: any) {
      errors.push(e.message ?? String(e));
    } finally {
      if (errors.length) setError(errors[0]);
      setLoading(false);
    }
  }, [ocSymbol, uniqueLegs, resolveUnderlying, resolveOption, fetchDay, flushAccum]); // eslint-disable-line react-hooks/exhaustive-deps

  fetchAllRef.current = fetchAll;

  // ── loadMore: step back one trading day on scroll-left ────────────────────────
  const loadMore = useCallback(async () => {
    if (loadLockRef.current || isLoadingMoreRef.current || !oldestDateRef.current) return;

    isLoadingMoreRef.current = true;
    loadLockRef.current = true;
    setLoadingMore(true);

    const today    = lastTradingDay();
    const prevDate = prevTradingDay(oldestDateRef.current);
    const underlying = resolveUnderlying();
    const legInfos: { key: string; symbol: string; exchange: string }[] = [];
    for (const leg of uniqueLegs) {
      const info = resolveOption(leg);
      if (info) legInfos.push({ key: `${leg.strike}${leg.type}`, ...info });
    }

    // Snapshot visible range BEFORE async work so we can restore it after setData
    const ts       = chartRef.current?.timeScale();
    const visRange = ts?.getVisibleRange();

    try {
      if (!loadedDatesRef.current.has(prevDate)) {
        await fetchDay(prevDate, today, underlying, legInfos, true);
        oldestDateRef.current = prevDate;
        setFromDate(prevDate);
      }

      // Apply data then restore view
      const ss  = seriesRef.current;
      const acc = accumRef.current;
      requestAnimationFrame(() => {
        if (ss.underlying && acc.underlying.length) ss.underlying.setData(acc.underlying);
        for (const [key, data] of acc.options) ss.options.get(key)?.setData(data);
        for (const [key, data] of acc.deltas)  ss.deltas.get(key)?.setData(data);
        for (const [key, data] of acc.ivs)     ss.ivs.get(key)?.setData(data);
        if (visRange && ts) setTimeout(() => ts.setVisibleRange(visRange), 50);
      });

    } catch (e) {
      console.warn('[StrategyChart] loadMore error', e);
    } finally {
      isLoadingMoreRef.current = false;
      setLoadingMore(false);
      setTimeout(() => { loadLockRef.current = false; }, 800);
    }
  }, [resolveUnderlying, resolveOption, uniqueLegs, fetchDay]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Subscribe to scroll: trigger loadMore at left edge ───────────────────────
  useEffect(() => {
    if (!chartReady) return;
    const chart = chartRef.current;
    if (!chart) return;
    const ts = chart.timeScale();

    const handler = (range: LogicalRange | null) => {
      if (!range || loadLockRef.current || !oldestDateRef.current) return;
      const ss = seriesRef.current;
      const refSeries = ss.underlying ?? ss.options.values().next().value ?? null;
      const barsInfo = refSeries?.barsInLogicalRange(range);
      if (barsInfo && barsInfo.barsBefore < 20) loadMore();
    };

    ts.subscribeVisibleLogicalRangeChange(handler);
    return () => ts.unsubscribeVisibleLogicalRangeChange(handler);
  }, [loadMore, chartReady]);

  // ── Auto-fetch when legs / symbol change ──────────────────────────────────────
  useEffect(() => {
    if (uniqueLegs.length === 0) return;
    const t = setTimeout(() => fetchAllRef.current(), 50);
    return () => clearTimeout(t);
  }, [legs.map(l => `${l.strike}${l.type}${l.expiry}${l.refId ?? ''}`).join(','), ocSymbol]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch when nubraInstruments loads after legs were already added
  useEffect(() => {
    if (nubraInstruments.length === 0 || uniqueLegs.length === 0) return;
    const t = setTimeout(() => fetchAllRef.current(), 50);
    return () => clearTimeout(t);
  }, [nubraInstruments.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasContent = !!ocSymbol && uniqueLegs.length > 0;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#171717', overflow: 'hidden', position: 'relative' }}>

      {!hasContent && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, color: '#3D4150', pointerEvents: 'none' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <span style={{ fontSize: 12 }}>Add legs to see strategy chart</span>
        </div>
      )}

      {hasContent && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#D1D4DC', letterSpacing: '0.06em' }}>STRATEGY CHART</span>
          <span style={{ fontSize: 10, color: '#3D4150' }}>·</span>
          <span style={{ fontSize: 11, color: UNDERLYING_COLOR, fontWeight: 600 }}>{ocSymbol}</span>
          <span style={{ fontSize: 10, color: '#565A6B' }}>{uniqueLegs.length} strike{uniqueLegs.length !== 1 ? 's' : ''}</span>

          {/* Date range — updates as user scrolls back */}
          {fromDate && toDate && (
            <span style={{ fontSize: 10, color: '#565A6B', fontFamily: 'monospace' }}>
              {fromDate === toDate
                ? formatDate(fromDate)
                : `${formatDate(fromDate)} – ${formatDate(toDate)}`}
            </span>
          )}

          <div style={{ flex: 1 }} />

          {loadingMore && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, border: '1.5px solid rgba(255,255,255,0.15)', borderTopColor: '#60a5fa', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
              <span style={{ fontSize: 10, color: '#565A6B' }}>Loading older data</span>
            </span>
          )}
          {loading && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, border: '1.5px solid rgba(255,255,255,0.15)', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
              <span style={{ fontSize: 10, color: '#565A6B' }}>Loading</span>
            </span>
          )}
          {error && <span style={{ fontSize: 10, color: '#f23645' }} title={error}>{error.slice(0, 60)}</span>}
          <button
            onClick={fetchAll} disabled={loading}
            style={{ fontSize: 10, fontWeight: 700, color: '#60a5fa', background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 5, padding: '3px 8px', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.5 : 1 }}
          >
            Refresh
          </button>
        </div>
      )}

      {hasContent && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', padding: '4px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: 0 }}>
          {legendItems.map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 16, height: 2, background: item.color, borderRadius: 1 }} />
              <span style={{ fontSize: 10, color: '#9CA3AF', fontFamily: 'monospace' }}>{item.label}</span>
            </div>
          ))}
        </div>
      )}

      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
