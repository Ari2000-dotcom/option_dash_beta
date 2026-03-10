import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  LineSeries,
  BaselineSeries,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type BaselineData,
  type Time,
  type LogicalRange,
  type SeriesMarker,
} from 'lightweight-charts';
import type { NubraInstrument } from './useNubraInstruments';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StrategyLeg {
  symbol: string;
  expiry: string;
  strike: number;
  type: 'CE' | 'PE';
  action: 'B' | 'S';
  price: number;      // entry LTP
  lots: number;
  refId?: number;
  lotSize: number;
  entryTime?: string; // HH:MM:SS when user entered the leg (IST)
  entryDate?: string; // YYYY-MM-DD date of entry (IST)
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
  mtm: ISeriesApi<'Baseline'> | null;
  options: Map<string, ISeriesApi<'Line'>>;
  deltas:  Map<string, ISeriesApi<'Line'>>;
  ivs:     Map<string, ISeriesApi<'Line'>>;
}

interface AccumData {
  underlying: LineData[];
  mtm: BaselineData[];
  options: Map<string, LineData[]>;
  deltas:  Map<string, LineData[]>;
  ivs:     Map<string, LineData[]>;
}

function isMarketOpen(): boolean {
  const now = new Date();
  const istMin = ((now.getUTCHours() * 60 + now.getUTCMinutes()) + 330) % 1440;
  const istDay = new Date(now.getTime() + 330 * 60000);
  if ([0, 6].includes(istDay.getUTCDay())) return false;
  return istMin >= 9 * 60 + 15 && istMin < 15 * 60 + 30;
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

// Fetch option close only
async function fetchOptionCloseForDate(
  symbol: string,
  exchange: string,
  date: string,
  today: string,
): Promise<{ close: LineData[] }> {
  const { startDate, endDate, intraDay } = buildDateParams(date, today);
  const chart = await nubraPost({
    exchange, type: 'OPT', values: [symbol], fields: ['close'],
    startDate, endDate, interval: '1m', intraDay,
  });
  const toLine = (arr: any[], scale = 1): LineData[] =>
    sortDedup((arr ?? []).filter((p: any) => getTs(p)).map((p: any) => ({
      time: nsToTime(getTs(p)),
      value: getVal(p) * scale,
    })));
  return { close: toLine(chart.close ?? [], 1 / 100) };
}

// Fetch option delta + iv_mid only (lazy — called when user toggles Greeks on)
async function fetchOptionGreeksForDate(
  symbol: string,
  exchange: string,
  date: string,
  today: string,
): Promise<{ delta: LineData[]; iv: LineData[] }> {
  const { startDate, endDate, intraDay } = buildDateParams(date, today);
  const chart = await nubraPost({
    exchange, type: 'OPT', values: [symbol], fields: ['delta', 'iv_mid'],
    startDate, endDate, interval: '1m', intraDay,
  });
  const toLine = (arr: any[], scale = 1): LineData[] =>
    sortDedup((arr ?? []).filter((p: any) => getTs(p)).map((p: any) => ({
      time: nsToTime(getTs(p)),
      value: getVal(p) * scale,
    })));
  return {
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
    underlying: null, mtm: null, options: new Map(), deltas: new Map(), ivs: new Map(),
  });
  const fetchAllRef    = useRef<() => void>(() => {});
  const wsRef          = useRef<WebSocket | null>(null);
  const markersPluginRef = useRef<ReturnType<typeof createSeriesMarkers<Time>> | null>(null);
  const legsRef          = useRef<StrategyLeg[]>(legs);
  const greeksLoadedRef  = useRef<Set<string>>(new Set()); // dates that have Greeks loaded

  const accumRef = useRef<AccumData>({
    underlying: [], mtm: [], options: new Map(), deltas: new Map(), ivs: new Map(),
  });

  // Oldest date loaded so far — scroll-back steps this back one day at a time
  const oldestDateRef    = useRef<string | null>(null);
  const isLoadingMoreRef = useRef(false);
  const loadLockRef      = useRef(false);
  const loadedDatesRef   = useRef<Set<string>>(new Set());

  const [loading,     setLoading]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,       setError]       = useState('');
  const [showPositions, setShowPositions] = useState(false);
  const [, setLegendItems] = useState<{ label: string; color: string }[]>([]);
  const [chartReady,  setChartReady]  = useState(false);
  // Date range shown in header — updates as user scrolls back
  const [fromDate, setFromDate] = useState<string | null>(null);
  const [toDate,   setToDate]   = useState<string | null>(null);
  // Toolbar visibility toggles
  const [showSpot,    setShowSpot]    = useState(true);
  const [showOptions, setShowOptions] = useState(true);
  const [showMtm,     setShowMtm]     = useState(true);
  const [showDelta,   setShowDelta]   = useState(false);
  const [showIv,      setShowIv]      = useState(false);
  const showDeltaRef = useRef(showDelta);
  const showIvRef    = useRef(showIv);
  showDeltaRef.current = showDelta;
  showIvRef.current    = showIv;

  const uniqueLegs = legs.filter((leg, i, arr) =>
    arr.findIndex(l => l.strike === leg.strike && l.type === leg.type) === i
  );
  // Keep legsRef always fresh so callbacks with [] deps can read latest legs
  legsRef.current = legs;

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
      localization: {
        timeFormatter: (ts: number) =>
          new Date(ts * 1000).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata', month: 'short', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false,
          }),
      },
      timeScale: {
        borderColor: '#2a2a2a', timeVisible: true, secondsVisible: false,
        tickMarkFormatter: (ts: number) => {
          const d = new Date(ts * 1000);
          const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
          const hh = String(ist.getUTCHours()).padStart(2, '0');
          const mm = String(ist.getUTCMinutes()).padStart(2, '0');
          const dd = ist.getUTCDate();
          const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][ist.getUTCMonth()];
          // Show date label when minute is 00 (day boundary), else HH:MM
          return mm === '00' && hh === '09' ? `${dd} ${mon}` : `${hh}:${mm}`;
        },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale:  { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    });
    chartRef.current = chart;

    // Keep pane 0 (spot price) at 45% of container height at all times
    const applyPaneHeights = () => {
      const totalH = containerRef.current?.clientHeight ?? 0;
      if (!totalH) return;
      const p0h = Math.round(totalH * 0.45);
      try { chart.panes()[0]?.setHeight(p0h); } catch { /**/ }
    };
    const ro = new ResizeObserver(applyPaneHeights);
    if (containerRef.current) ro.observe(containerRef.current);
    setTimeout(applyPaneHeights, 100);

    setChartReady(true);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      setChartReady(false);
      seriesRef.current = { underlying: null, mtm: null, options: new Map(), deltas: new Map(), ivs: new Map() };
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
      // Spot occupies top ~48% of pane 0, leaves bottom 52% for MTM
      chart.priceScale('left').applyOptions({ scaleMargins: { top: 0.04, bottom: 0.52 } });
    }

    let ceCount = 0, peCount = 0;
    for (const leg of uniqueLegs) {
      const key = `${leg.strike}${leg.type}`;
      const colorIdx = leg.type === 'CE' ? ceCount++ : peCount++;
      const color = optionColor(leg.type, colorIdx);

      if (!ss.options.has(key)) {
        ss.options.set(key, chart.addSeries(LineSeries, {
          color, lineWidth: 2 as 2, title: `${leg.strike}${leg.type}`,
          priceFormat: { type: 'price', precision: 2, minMove: 0.05 },
          priceScaleId: 'right',
        }, 0));
        chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.04, bottom: 0.52 } });
      }
      if (!ss.deltas.has(key)) {
        ss.deltas.set(key, chart.addSeries(LineSeries, {
          color: leg.type === 'CE' ? DELTA_COLORS[colorIdx % DELTA_COLORS.length] : PE_COLORS[colorIdx % PE_COLORS.length],
          lineWidth: 2 as 2, title: `Δ ${leg.strike}${leg.type}`,
          priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
        }, 1));
        try { chart.panes()[1]?.setHeight(110); } catch { /**/ }
      }
      if (!ss.ivs.has(key)) {
        ss.ivs.set(key, chart.addSeries(LineSeries, {
          color: IV_COLORS[colorIdx % IV_COLORS.length],
          lineWidth: 2 as 2, title: `IV ${leg.strike}${leg.type}`,
          priceFormat: { type: 'percent', precision: 2, minMove: 0.01 },
        }, 2));
        try { chart.panes()[2]?.setHeight(90); } catch { /**/ }
      }
    }

    // MTM baseline series — pane 0, right axis (separate scale id so it doesn't mix with option prices)
    if (!ss.mtm) {
      ss.mtm = chart.addSeries(BaselineSeries, {
        title: 'MTM',
        baseValue: { type: 'price', price: 0 },
        topLineColor:    'rgba(38,166,154,0.9)',
        topFillColor1:   'rgba(38,166,154,0.25)',
        topFillColor2:   'rgba(38,166,154,0.05)',
        bottomLineColor: 'rgba(242,54,69,0.9)',
        bottomFillColor1:'rgba(242,54,69,0.05)',
        bottomFillColor2:'rgba(242,54,69,0.25)',
        lineWidth: 2 as 2,
        priceScaleId: 'mtm',
        priceFormat: {
          type: 'custom',
          minMove: 0.01,
          formatter: (v: number) => {
            const abs = Math.abs(v);
            if (abs >= 100000) return `₹${(v / 100000).toFixed(2)}L`;
            if (abs >= 1000)   return `₹${(v / 1000).toFixed(2)}K`;
            return `₹${v.toFixed(2)}`;
          },
        },
      }, 0);
      // MTM occupies bottom ~42% of pane 0, leaves top 58% for spot/options
      chart.priceScale('mtm').applyOptions({ scaleMargins: { top: 0.58, bottom: 0.04 }, visible: true, borderColor: '#2a2a2a' });
    }

    const items: { label: string; color: string }[] = [{ label: ocSymbol, color: UNDERLYING_COLOR }];
    let ci = 0, pi = 0;
    for (const leg of uniqueLegs) {
      if (leg.type === 'CE') items.push({ label: `${leg.strike} CE`, color: CE_COLORS[ci++ % CE_COLORS.length] });
      else                   items.push({ label: `${leg.strike} PE`, color: PE_COLORS[pi++ % PE_COLORS.length] });
    }
    items.push({ label: 'MTM', color: '#26a69a' });
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
    const snapMtm     = acc.mtm.slice();
    const snapOptions = new Map(acc.options);
    const snapDeltas  = new Map(acc.deltas);
    const snapIvs     = new Map(acc.ivs);

    // Compute entry marker timestamps — use entryDate+entryTime, floored to minute
    // Use legsRef.current (always fresh) because flushAccum has [] deps
    // One arrowUp marker per unique timestamp — legs at same time are grouped, count shown as text
    const entryMarkers: SeriesMarker<Time>[] = [];
    const timeLegs = new Map<number, typeof legsRef.current>();
    for (const leg of legsRef.current) {
      if (!leg.entryTime || !leg.entryDate) continue;
      const [hh, mm] = leg.entryTime.split(':').map(Number);
      const [yr, mo, dy] = leg.entryDate.split('-').map(Number);
      const midUtc = Date.UTC(yr, mo - 1, dy) / 1000;
      const t = Math.round(midUtc + hh * 3600 + mm * 60 - 5.5 * 3600);
      const arr = timeLegs.get(t) ?? [];
      arr.push(leg);
      timeLegs.set(t, arr);
    }
    for (const [t, tLegs] of timeLegs) {
      const count = tLegs.length;
      // Label: single leg → "B 24500CE", multiple legs → "↑ 3 legs"
      const label = count === 1
        ? `${tLegs[0].action} ${tLegs[0].strike}${tLegs[0].type}`
        : `${count} legs`;
      entryMarkers.push({
        time: t as unknown as Time,
        position: 'belowBar',
        color: '#e0a800',
        shape: 'arrowUp',
        text: label,
        size: count > 2 ? 2 : 1,
      });
    }

    requestAnimationFrame(() => {
      if (ss.underlying && snapUnderly.length) ss.underlying.setData(snapUnderly);
      if (ss.mtm && snapMtm.length) ss.mtm.setData(snapMtm);
      for (const [key, data] of snapOptions) ss.options.get(key)?.setData(data);
      for (const [key, data] of snapDeltas)  ss.deltas.get(key)?.setData(data);
      for (const [key, data] of snapIvs)     ss.ivs.get(key)?.setData(data);

      // Place entry markers on the MTM series — yellow arrowUp per entry time
      if (entryMarkers.length && ss.mtm) {
        try {
          markersPluginRef.current?.detach();
          markersPluginRef.current = createSeriesMarkers(ss.mtm, entryMarkers);
        } catch { /**/ }
      }

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

      // Each option: close only — Greeks loaded lazily on toggle
      ...legInfos.map(({ key, symbol, exchange }) =>
        fetchOptionCloseForDate(symbol, exchange, date, today)
          .then(({ close }) => {
            if (close.length) {
              gotAny = true;
              const prev = acc.options.get(key) ?? [];
              acc.options.set(key, prepend ? mergeData(close, prev) : mergeData(prev, close));
            }
          })
          .catch((e: any) => console.warn('[StrategyChart] option failed', symbol, date, e.message))
      ),
    ]);

    // Recompute MTM fresh from ALL accumulated option data
    if (gotAny && legInfos.length > 0) {
      // Only filter by entry time on today's date — historical days show full MTM
      let entryUnix = 0;
      if (date === today) {
        for (const { key } of legInfos) {
          const leg = uniqueLegs.find(l => `${l.strike}${l.type}` === key);
          if (!leg?.entryTime) continue;
          const [hh, mm] = leg.entryTime.split(':').map(Number);
          const [yr, mo, dy] = date.split('-').map(Number);
          const midnightUtc = Date.UTC(yr, mo - 1, dy) / 1000;
          // Floor to minute — candles are at :00 second boundaries
          const legUnix = midnightUtc + hh * 3600 + mm * 60 - 5.5 * 3600;
          if (legUnix > entryUnix) entryUnix = legUnix;
        }
      }

      // Build lookup maps for O(1) access: key → Map<timestamp, value>
      const optMaps = new Map<string, Map<number, number>>();
      for (const { key } of legInfos) {
        const m = new Map<number, number>();
        for (const pt of acc.options.get(key) ?? []) m.set(pt.time as number, pt.value);
        optMaps.set(key, m);
      }

      // Collect all timestamps — on today filter by entry, on historical show all
      const tsSet = new Set<number>();
      for (const { key } of legInfos) {
        for (const [t] of optMaps.get(key) ?? []) {
          if (entryUnix === 0 || t >= entryUnix) tsSet.add(t);
        }
      }
      const timestamps = [...tsSet].sort((a, b) => a - b);

      // Recompute MTM fully from scratch
      acc.mtm = timestamps.map(t => {
        let total = 0;
        for (const { key } of legInfos) {
          const leg = uniqueLegs.find(l => `${l.strike}${l.type}` === key);
          if (!leg) continue;
          const currLtp = optMaps.get(key)?.get(t) ?? 0;
          total += (leg.action === 'B' ? currLtp - leg.price : leg.price - currLtp) * leg.lots * (leg.lotSize || 1);
        }
        return { time: t as Time, value: total };
      });
    }

    return gotAny;
  }, [uniqueLegs]);

  // ── Initial load: today only via Nubra ───────────────────────────────────────
  const fetchAll = useCallback(async () => {
    if (!ocSymbol || uniqueLegs.length === 0 || !chartRef.current) return;
    setLoading(true);
    setError('');
    setFromDate(null);
    setToDate(null);

    accumRef.current = { underlying: [], mtm: [], options: new Map(), deltas: new Map(), ivs: new Map() };
    loadedDatesRef.current   = new Set();
    greeksLoadedRef.current  = new Set();
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
        if (ss.mtm && acc.mtm.length) ss.mtm.setData(acc.mtm);
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

  // ── Live WS feed — connect when chart has data, append each tick ─────────────
  useEffect(() => {
    if (!isMarketOpen() || uniqueLegs.length === 0 || !ocSymbol) return;

    // Close any existing WS first
    wsRef.current?.close();
    wsRef.current = null;

    const sessionToken = localStorage.getItem('nubra_session_token') ?? '';
    if (!sessionToken) return;

    // Unique expiries across all legs
    const expiries = [...new Set(uniqueLegs.map(l => l.expiry))];

    const ws = new WebSocket('ws://localhost:8765');
    wsRef.current = ws;

    ws.onopen = () => {
      for (const expiry of expiries) {
        ws.send(JSON.stringify({
          action: 'subscribe',
          session_token: sessionToken,
          data_type: 'option',
          symbols: [`${ocSymbol}:${expiry}`],
          exchange: ocExchange,
        }));
      }
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type !== 'option' || !msg.data) return;

        const d = msg.data;
        const ss = seriesRef.current;
        const acc = accumRef.current;

        // Round to current 1-min candle boundary
        const nowUnix = Math.floor(Date.now() / 60000) * 60;

        // Helper: upsert a point into an accum array and call series.update()
        const upsert = (arr: LineData[], series: ISeriesApi<'Line'> | null, pt: LineData) => {
          const last = arr[arr.length - 1];
          if (last && (last.time as number) === (pt.time as number)) arr[arr.length - 1] = pt;
          else arr.push(pt);
          series?.update(pt);
        };

        // ── Underlying spot ──
        const spot = d.current_price ?? 0;
        if (spot > 0) {
          upsert(acc.underlying, ss.underlying, { time: nowUnix as unknown as Time, value: spot });
        }

        // ── Build maps: key → { ltp, delta, iv } from WS tick ──
        type TickFields = { ltp: number; delta: number; iv: number };
        const tickMap = new Map<string, TickFields>();
        for (const opt of (d.ce ?? []) as Record<string, number>[]) {
          const strike = opt.strike_price ?? 0;
          if (!strike) continue;
          tickMap.set(`${strike}CE`, {
            ltp:   opt.last_traded_price ?? 0,
            delta: opt.delta ?? 0,
            iv:    (opt.iv ?? 0) * 100,   // same scale as historical (×100 = percent)
          });
        }
        for (const opt of (d.pe ?? []) as Record<string, number>[]) {
          const strike = opt.strike_price ?? 0;
          if (!strike) continue;
          tickMap.set(`${strike}PE`, {
            ltp:   opt.last_traded_price ?? 0,
            delta: opt.delta ?? 0,
            iv:    (opt.iv ?? 0) * 100,
          });
        }

        // ── Update option price, delta, IV series ──
        let mtmTotal = 0;
        let allLegsHaveData = true;

        for (const leg of uniqueLegs) {
          const key = `${leg.strike}${leg.type}`;
          const tick = tickMap.get(key);
          if (!tick || tick.ltp === 0) { allLegsHaveData = false; continue; }

          const t = nowUnix as unknown as Time;

          // Option price
          const optPts = acc.options.get(key) ?? [];
          upsert(optPts, ss.options.get(key) ?? null, { time: t, value: tick.ltp });
          acc.options.set(key, optPts);

          // Delta — only update if toggle is on (use ref to avoid stale closure)
          if (showDeltaRef.current) {
            const dPts = acc.deltas.get(key) ?? [];
            upsert(dPts, ss.deltas.get(key) ?? null, { time: t, value: tick.delta });
            acc.deltas.set(key, dPts);
          }

          // IV — only update if toggle is on (use ref to avoid stale closure)
          if (showIvRef.current) {
            const ivPts = acc.ivs.get(key) ?? [];
            upsert(ivPts, ss.ivs.get(key) ?? null, { time: t, value: tick.iv });
            acc.ivs.set(key, ivPts);
          }

          // MTM accumulate
          mtmTotal += (leg.action === 'B' ? tick.ltp - leg.price : leg.price - tick.ltp) * leg.lots * (leg.lotSize || 1);
        }

        // ── MTM — only from entry time ──
        if (allLegsHaveData && ss.mtm) {
          let entryUnix = 0;
          for (const leg of uniqueLegs) {
            if (!leg.entryTime) continue;
            const [hh, mm] = leg.entryTime.split(':').map(Number);
            const now2 = new Date();
            const midUtc = Date.UTC(now2.getUTCFullYear(), now2.getUTCMonth(), now2.getUTCDate()) / 1000;
            // Floor to minute — matches 1-min candle boundaries
            const legUnix = midUtc + hh * 3600 + mm * 60 - 5.5 * 3600;
            if (legUnix > entryUnix) entryUnix = legUnix;
          }
          if (entryUnix === 0 || nowUnix >= entryUnix) {
            const mtmPt: BaselineData = { time: nowUnix as unknown as Time, value: mtmTotal };
            const last = acc.mtm[acc.mtm.length - 1];
            if (last && (last.time as number) === nowUnix) acc.mtm[acc.mtm.length - 1] = mtmPt;
            else acc.mtm.push(mtmPt);
            ss.mtm.update(mtmPt);
          }
        }

      } catch (err) { console.warn('[StrategyChart] WS parse error', err); }
    };

    ws.onerror = () => {};
    ws.onclose = () => {};

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [ocSymbol, ocExchange, uniqueLegs.map(l => `${l.strike}${l.type}${l.expiry}`).join(','), chartReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Wire visibility toggles to series ────────────────────────────────────────
  useEffect(() => {
    const ss = seriesRef.current;
    ss.underlying?.applyOptions({ visible: showSpot });
  }, [showSpot]);

  useEffect(() => {
    const ss = seriesRef.current;
    for (const s of ss.options.values()) s.applyOptions({ visible: showOptions });
  }, [showOptions]);

  useEffect(() => {
    const ss = seriesRef.current;
    ss.mtm?.applyOptions({ visible: showMtm });
  }, [showMtm]);

  useEffect(() => {
    const ss = seriesRef.current;
    for (const s of ss.deltas.values()) s.applyOptions({ visible: showDelta });
    if (!showDelta) return;
    // Lazy-load Greeks for all loaded dates not yet fetched
    const acc = accumRef.current;
    const today = lastTradingDay();
    const legs = legsRef.current.filter((leg, i, arr) =>
      arr.findIndex(l => l.strike === leg.strike && l.type === leg.type) === i
    );
    for (const date of loadedDatesRef.current) {
      if (greeksLoadedRef.current.has(date)) continue;
      greeksLoadedRef.current.add(date);
      for (const leg of legs) {
        const info = (() => {
          if (leg.refId) {
            const ins = nubraInstruments.find(i => String(i.ref_id) === String(leg.refId));
            if (ins) return { key: `${leg.strike}${leg.type}`, symbol: ins.stock_name || ins.nubra_name, exchange: ins.exchange || 'NSE' };
          }
          const strikePaise = Math.round(leg.strike * 100);
          const sym = ocSymbol.toUpperCase();
          const ins = nubraInstruments.find(i =>
            i.option_type === leg.type &&
            String(i.expiry) === String(leg.expiry) &&
            Math.abs((i.strike_price ?? 0) - strikePaise) < 2 &&
            ((i.asset ?? '').toUpperCase() === sym || (i.nubra_name ?? '').toUpperCase() === sym || (i.stock_name ?? '').toUpperCase().startsWith(sym))
          );
          if (ins) return { key: `${leg.strike}${leg.type}`, symbol: ins.stock_name || ins.nubra_name, exchange: ins.exchange || 'NSE' };
          return null;
        })();
        if (!info) continue;
        fetchOptionGreeksForDate(info.symbol, info.exchange, date, today)
          .then(({ delta, iv }) => {
            if (delta.length) {
              const prev = acc.deltas.get(info.key) ?? [];
              acc.deltas.set(info.key, mergeData(prev, delta));
              ss.deltas.get(info.key)?.setData(acc.deltas.get(info.key)!);
            }
            if (iv.length) {
              const prev = acc.ivs.get(info.key) ?? [];
              acc.ivs.set(info.key, mergeData(prev, iv));
              ss.ivs.get(info.key)?.setData(acc.ivs.get(info.key)!);
            }
          })
          .catch((e: any) => console.warn('[StrategyChart] greeks lazy load failed', e.message));
      }
    }
  }, [showDelta]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ss = seriesRef.current;
    for (const s of ss.ivs.values()) s.applyOptions({ visible: showIv });
    if (!showIv) return;
    // Lazy-load Greeks (same logic — reuse greeksLoadedRef so no double fetch)
    const acc = accumRef.current;
    const today = lastTradingDay();
    const legs = legsRef.current.filter((leg, i, arr) =>
      arr.findIndex(l => l.strike === leg.strike && l.type === leg.type) === i
    );
    for (const date of loadedDatesRef.current) {
      if (greeksLoadedRef.current.has(date)) continue;
      greeksLoadedRef.current.add(date);
      for (const leg of legs) {
        const info = (() => {
          if (leg.refId) {
            const ins = nubraInstruments.find(i => String(i.ref_id) === String(leg.refId));
            if (ins) return { key: `${leg.strike}${leg.type}`, symbol: ins.stock_name || ins.nubra_name, exchange: ins.exchange || 'NSE' };
          }
          const strikePaise = Math.round(leg.strike * 100);
          const sym = ocSymbol.toUpperCase();
          const ins = nubraInstruments.find(i =>
            i.option_type === leg.type &&
            String(i.expiry) === String(leg.expiry) &&
            Math.abs((i.strike_price ?? 0) - strikePaise) < 2 &&
            ((i.asset ?? '').toUpperCase() === sym || (i.nubra_name ?? '').toUpperCase() === sym || (i.stock_name ?? '').toUpperCase().startsWith(sym))
          );
          if (ins) return { key: `${leg.strike}${leg.type}`, symbol: ins.stock_name || ins.nubra_name, exchange: ins.exchange || 'NSE' };
          return null;
        })();
        if (!info) continue;
        fetchOptionGreeksForDate(info.symbol, info.exchange, date, today)
          .then(({ delta, iv }) => {
            if (delta.length) {
              const prev = acc.deltas.get(info.key) ?? [];
              acc.deltas.set(info.key, mergeData(prev, delta));
              ss.deltas.get(info.key)?.setData(acc.deltas.get(info.key)!);
            }
            if (iv.length) {
              const prev = acc.ivs.get(info.key) ?? [];
              acc.ivs.set(info.key, mergeData(prev, iv));
              ss.ivs.get(info.key)?.setData(acc.ivs.get(info.key)!);
            }
          })
          .catch((e: any) => console.warn('[StrategyChart] greeks lazy load failed', e.message));
      }
    }
  }, [showIv]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <div style={{ flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {/* ── Row 1: title + meta + status + refresh ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#D1D4DC', letterSpacing: '0.06em' }}>STRATEGY CHART</span>
            <span style={{ fontSize: 10, color: '#3D4150' }}>·</span>
            <span style={{ fontSize: 11, color: UNDERLYING_COLOR, fontWeight: 600 }}>{ocSymbol}</span>
            <span style={{ fontSize: 10, color: '#565A6B' }}>{uniqueLegs.length} strike{uniqueLegs.length !== 1 ? 's' : ''}</span>
            {fromDate && toDate && (
              <span style={{ fontSize: 10, color: '#565A6B', fontFamily: 'monospace' }}>
                {fromDate === toDate ? formatDate(fromDate) : `${formatDate(fromDate)} – ${formatDate(toDate)}`}
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
            >Refresh</button>
          </div>

          {/* ── Row 2: toggle toolbar ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: 'rgba(255,255,255,0.015)' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#3D4150', letterSpacing: '0.06em', marginRight: 4 }}>SHOW</span>
            {([
              { key: 'spot',    label: 'Spot',    color: UNDERLYING_COLOR,  on: showSpot,    set: setShowSpot },
              { key: 'options', label: 'Options', color: '#2ebd85',         on: showOptions, set: setShowOptions },
              { key: 'mtm',     label: 'MTM',     color: '#26a69a',         on: showMtm,     set: setShowMtm },
              { key: 'delta',   label: 'Delta',   color: DELTA_COLORS[0],  on: showDelta,   set: setShowDelta },
              { key: 'iv',      label: 'IV',      color: IV_COLORS[0],     on: showIv,      set: setShowIv },
            ] as const).map(({ key, label, color, on, set }) => (
              <button
                key={key}
                onClick={() => set((v: boolean) => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
                  fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                  border: `1px solid ${on ? color : 'rgba(255,255,255,0.08)'}`,
                  background: on ? `${color}22` : 'transparent',
                  color: on ? color : '#4B5563',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 2, background: on ? color : 'rgba(255,255,255,0.12)', display: 'inline-block', flexShrink: 0 }} />
                {label}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            {/* Positions button — always visible when legs exist */}
            <button
              onClick={() => setShowPositions(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
                fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                border: `1px solid ${showPositions ? '#e0a800' : 'rgba(255,255,255,0.08)'}`,
                background: showPositions ? 'rgba(224,168,0,0.12)' : 'transparent',
                color: showPositions ? '#e0a800' : '#4B5563',
                transition: 'all 0.15s',
              }}
            >
              {/* Arrow-up from line — matches the chart entry marker */}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5"/><path d="M5 12l7-7 7 7"/><line x1="4" y1="20" x2="20" y2="20"/>
              </svg>
              Positions
              <span style={{
                fontSize: 10, fontWeight: 800,
                background: showPositions ? 'rgba(224,168,0,0.25)' : 'rgba(255,255,255,0.07)',
                color: showPositions ? '#e0a800' : '#565A6B',
                borderRadius: 4, padding: '0 5px', marginLeft: 2,
              }}>{legs.length}</span>
            </button>
          </div>
        </div>
      )}

      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />

      {/* ── Positions overlay ─────────────────────────────────────────── */}
      {showPositions && legs.length > 0 && (
        <div style={{
          position: 'absolute', top: 80, right: 12, zIndex: 20,
          background: '#1a1714',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          overflow: 'hidden',
          minWidth: 360,
          maxWidth: 480,
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px 8px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(255,255,255,0.02)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Positions tab icon — arrow up from line (entry marker icon) */}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#e0a800" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5"/>
                <path d="M5 12l7-7 7 7"/>
                <line x1="4" y1="20" x2="20" y2="20"/>
              </svg>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#D1D4DC', letterSpacing: '0.06em' }}>POSITIONS</span>
              <span style={{ fontSize: 10, color: '#565A6B' }}>{legs.length} leg{legs.length !== 1 ? 's' : ''}</span>
            </div>
            <button
              onClick={() => setShowPositions(false)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#374151', padding: 2, display: 'flex', alignItems: 'center' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#f23645'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#374151'; }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          {/* Column headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: '44px 1fr 52px 64px 64px',
            padding: '5px 14px 4px',
            background: '#333333',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
            {['B/S', 'Instrument', 'Lots', 'Entry', 'Time'].map((h, i) => (
              <span key={i} style={{ fontSize: 9, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: i >= 2 ? 'right' : 'left' }}>{h}</span>
            ))}
          </div>

          {/* Rows */}
          <div style={{ maxHeight: 280, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#2a2a2a transparent' }}>
            {legs.map((leg, i) => {
              const isBuy = leg.action === 'B';
              const legColor = leg.type === 'CE'
                ? CE_COLORS[legs.filter((l, j) => j < i && l.type === 'CE').length % CE_COLORS.length]
                : PE_COLORS[legs.filter((l, j) => j < i && l.type === 'PE').length % PE_COLORS.length];
              return (
                <div
                  key={i}
                  style={{
                    display: 'grid', gridTemplateColumns: '44px 1fr 52px 64px 64px',
                    alignItems: 'center', padding: '7px 14px',
                    borderBottom: i < legs.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.03)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                >
                  {/* B/S badge */}
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 34, height: 18, borderRadius: 4,
                    background: isBuy ? 'rgba(38,166,154,0.18)' : 'rgba(242,54,69,0.18)',
                    border: `1px solid ${isBuy ? 'rgba(38,166,154,0.45)' : 'rgba(242,54,69,0.45)'}`,
                  }}>
                    <span style={{ fontSize: 9, fontWeight: 800, color: isBuy ? '#26a69a' : '#f23645', letterSpacing: '0.05em' }}>
                      {isBuy ? 'BUY' : 'SELL'}
                    </span>
                  </div>

                  {/* Instrument */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: legColor, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#E2E8F0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {leg.strike} <span style={{ color: leg.type === 'CE' ? '#26a69a' : '#f23645' }}>{leg.type}</span>
                    </span>
                    <span style={{ fontSize: 9, color: '#4B5563', fontWeight: 500 }}>
                      {leg.expiry ? `${leg.expiry.slice(6, 8)}/${leg.expiry.slice(4, 6)}` : ''}
                    </span>
                  </div>

                  {/* Lots */}
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', textAlign: 'right', fontFamily: 'monospace' }}>
                    ×{leg.lots}
                  </span>

                  {/* Entry price */}
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#E2E8F0', textAlign: 'right', fontFamily: 'monospace' }}>
                    ₹{leg.price.toFixed(2)}
                  </span>

                  {/* Entry time */}
                  <span style={{ fontSize: 10, color: leg.entryTime ? '#e0a800' : '#374151', textAlign: 'right', fontFamily: 'monospace' }}>
                    {leg.entryTime ? leg.entryTime.slice(0, 5) : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
