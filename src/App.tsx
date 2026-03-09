import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useInstruments, type Instrument } from './useInstruments';
import { loadNubraInstruments } from './db';
import type { NubraInstrument } from './useNubraInstruments';
import OptionChain from './OptionChain';
import StrategyChart from './StrategyChart';
import LoadingScreen from './LoadingScreen';
import StraddleChart from './StraddleChart';
import OIProfileView from './OIProfileView';
import { WorkspaceRoot } from './workspace/WorkspaceRoot';
import { useWorkspaceState } from './workspace/useWorkspaceState';
import NubraApiTester from './NubraApiTester';
import Backtest from './Backtest';
import HistoricalWorkspace from './HistoricalWorkspace';
import { wsManager } from './lib/WebSocketManager';
import { useWsConnected } from './hooks/useMarketData';
import { cx } from './lib/utils';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
} from './components/ui/sidebar';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import './index.css';

type Page = 'chart' | 'straddle' | 'oiprofile' | 'nubra' | 'backtest' | 'historical' | 'mtm';
type Tab = 'ALL' | 'Cash' | 'F&O' | 'Currency' | 'Commodity';

const TABS: Tab[] = ['ALL', 'Cash', 'F&O', 'Currency', 'Commodity'];

function filterByTab(instruments: Instrument[], tab: Tab): Instrument[] {
  if (tab === 'ALL') return instruments;
  if (tab === 'Cash') return instruments.filter(i => i.instrument_type === 'EQ');
  if (tab === 'F&O') return instruments.filter(i => i.segment === 'NSE_FO' || i.segment === 'BSE_FO');
  if (tab === 'Currency') return instruments.filter(i => i.segment === 'NCD_FO' || i.asset_type === 'CUR');
  if (tab === 'Commodity') return instruments.filter(i => i.asset_type === 'COM' || i.segment?.includes('MCX') || i.segment === 'NSE_COM' || i.exchange === 'MCX');
  return instruments;
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ color: '#FF9800', fontWeight: 600 }}>{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

// ── Inline SVG icons ──────────────────────────────────────────────────────────
function IconSearch() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>;
}
function IconClose() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>;
}
function IconBolt() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>;
}
function IconApi() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>;
}
function IconCookie() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><circle cx="8" cy="8" r="1" fill="currentColor" /><circle cx="15" cy="9" r="1" fill="currentColor" /><circle cx="9" cy="15" r="1" fill="currentColor" /></svg>;
}

// ── Page nav items ────────────────────────────────────────────────────────────
// Charts — candlestick bars
function IconBarChart2() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}
// Straddle — stacked layers (options spread)
function IconLayers() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}
// OI Profile — pulse/waveform (open interest activity)
function IconActivity() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
// Nubra IV — beaker/flask (implied volatility lab)
function IconFlask() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6" />
      <path d="M10 3v7l-4 8a1 1 0 0 0 .9 1.45h10.2a1 1 0 0 0 .9-1.45L14 10V3" />
    </svg>
  );
}
// Backtest — play button inside circle (run simulation)
function IconClock() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
    </svg>
  );
}
// Historical — calendar with clock (historical data)
function IconHistory() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <polyline points="9 16 12 14 12 18" />
    </svg>
  );
}

// MTM Analyzer icon
function IconTrendingUp() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 16 16" fill="none">
      <path fillRule="evenodd" clipRule="evenodd" d="M2.36426 7.95608C2.36426 7.76678 2.51777 7.61328 2.70712 7.61328H3.05582C3.24517 7.61328 3.39867 7.76678 3.39867 7.95608C3.39867 8.14548 3.24517 8.29898 3.05582 8.29898H2.70712C2.51777 8.29898 2.36426 8.14548 2.36426 7.95608ZM3.63963 7.95608C3.63963 7.76678 3.79313 7.61328 3.98249 7.61328H4.67988C4.86923 7.61328 5.02274 7.76678 5.02274 7.95608C5.02274 8.14548 4.86923 8.29898 4.67988 8.29898H3.98249C3.79313 8.29898 3.63963 8.14548 3.63963 7.95608ZM5.26369 7.95608C5.26369 7.76678 5.4172 7.61328 5.60655 7.61328H6.30394C6.49328 7.61328 6.64678 7.76678 6.64678 7.95608C6.64678 8.14548 6.49328 8.29898 6.30394 8.29898H5.60655C5.4172 8.29898 5.26369 8.14548 5.26369 7.95608ZM6.88778 7.95608C6.88778 7.76678 7.04128 7.61328 7.23058 7.61328H7.92798C8.11738 7.61328 8.27088 7.76678 8.27088 7.95608C8.27088 8.14548 8.11738 8.29898 7.92798 8.29898H7.23058C7.04128 8.29898 6.88778 8.14548 6.88778 7.95608ZM8.51178 7.95608C8.51178 7.76678 8.66528 7.61328 8.85468 7.61328H9.55208C9.74138 7.61328 9.89488 7.76678 9.89488 7.95608C9.89488 8.14548 9.74138 8.29898 9.55208 8.29898H8.85468C8.66528 8.29898 8.51178 8.14548 8.51178 7.95608ZM10.1359 7.95608C10.1359 7.76678 10.2894 7.61328 10.4788 7.61328H11.1761C11.3655 7.61328 11.519 7.76678 11.519 7.95608C11.519 8.14548 11.3655 8.29898 11.1761 8.29898H10.4788C10.2894 8.29898 10.1359 8.14548 10.1359 7.95608ZM11.76 7.95608C11.76 7.76678 11.9135 7.61328 12.1028 7.61328H12.8002C12.9896 7.61328 13.1431 7.76678 13.1431 7.95608C13.1431 8.14548 12.9896 8.29898 12.8002 8.29898H12.1028C11.9135 8.29898 11.76 8.14548 11.76 7.95608ZM13.384 7.95608C13.384 7.76678 13.5375 7.61328 13.7269 7.61328H14.0756C14.2649 7.61328 14.4184 7.76678 14.4184 7.95608C14.4184 8.14548 14.2649 8.29898 14.0756 8.29898H13.7269C13.5375 8.29898 13.384 8.14548 13.384 7.95608Z" fill="currentColor" />
      <path fillRule="evenodd" clipRule="evenodd" d="M10.2382 3.31291C10.3093 3.1246 10.4896 3 10.6909 3H14.484C14.7514 3 14.9681 3.21671 14.9681 3.48403C14.9681 3.75136 14.7514 3.96807 14.484 3.96807H11.0255L7.76439 12.5963C7.69329 12.7847 7.51299 12.9093 7.31159 12.9093H2.48404C2.21671 12.9093 2 12.6925 2 12.4252C2 12.1579 2.21671 11.9412 2.48404 11.9412H6.97709L10.2382 3.31291Z" fill="currentColor" />
    </svg>
  );
}

function StatusDot({ status }: { status: 'ok' | 'warn' | 'indigo' | 'off' }) {
  const colors = {
    ok: 'bg-[#2ebd85] shadow-[0_0_5px_#2ebd85]',
    warn: 'bg-[#FF9800] shadow-[0_0_5px_#FF9800]',
    indigo: 'bg-[#818cf8] shadow-[0_0_5px_#818cf8] animate-pulse',
    off: 'bg-[#333333]',
  };
  return <span className={cx('inline-block w-1.5 h-1.5 rounded-full shrink-0', colors[status])} />;
}

function Btn({
  onClick, loading, children, variant = 'default', disabled, title,
}: {
  onClick?: () => void; loading?: boolean; children: React.ReactNode;
  variant?: 'default' | 'primary' | 'ghost' | 'green' | 'indigo' | 'amber';
  disabled?: boolean; title?: string;
}) {
  const base = 'inline-flex items-center gap-1.5 h-6 px-2.5 text-[11px] font-semibold tracking-[0.04em] border transition-colors duration-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
  const variants = {
    default: 'bg-transparent border-[#2a2a2a] text-[#787B86] hover:border-[#333333] hover:text-[#D1D4DC]',
    primary: 'bg-[rgba(255,152,0,0.85)] border-[rgba(255,152,0,0.5)] text-white hover:bg-[rgba(255,152,0,1)]',
    ghost: 'bg-transparent border-transparent text-zinc-500 hover:text-zinc-400',
    green: 'bg-[rgba(46,189,133,0.08)] border-[rgba(46,189,133,0.4)] text-[#2ebd85] hover:bg-[rgba(46,189,133,0.15)]',
    indigo: 'bg-[rgba(129,140,248,0.08)] border-[rgba(129,140,248,0.35)] text-[#818cf8] hover:bg-[rgba(129,140,248,0.15)]',
    amber: 'bg-[rgba(255,152,0,0.10)] border-[rgba(255,152,0,0.45)] text-[#FF9800] hover:bg-[rgba(255,152,0,0.15)]',
  };
  return (
    <button onClick={onClick} disabled={disabled || loading} title={title} className={cx(base, variants[variant])}>
      {loading && <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />}
      {children}
    </button>
  );
}

function TextInput({ value, onChange, onEnter, onEscape, placeholder, autoFocus, width, type = 'text' }: {
  value: string; onChange: (v: string) => void; onEnter?: () => void; onEscape?: () => void;
  placeholder?: string; autoFocus?: boolean; width?: number | string; type?: string;
}) {
  return (
    <input
      type={type} value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') onEnter?.(); if (e.key === 'Escape') onEscape?.(); }}
      placeholder={placeholder} autoFocus={autoFocus}
      style={{ width }}
      className="h-6 px-2 text-[11px] bg-[#1f1f1f] border border-[#2a2a2a] text-[#D1D4DC] placeholder-[#4A4E5C] outline-none focus:border-[rgba(255,152,0,0.45)] transition-colors"
    />
  );
}

function TextAreaInput({ value, onChange, placeholder, autoFocus, width }: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; width?: number | string;
}) {
  return (
    <textarea
      value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} autoFocus={autoFocus} rows={1}
      style={{ width, resize: 'none' }}
      className="px-2 py-1 text-[10px] bg-[#1f1f1f] border border-[#2a2a2a] text-[#D1D4DC] placeholder-[#4A4E5C] outline-none focus:border-[rgba(255,152,0,0.45)] transition-colors"
    />
  );
}

// Shows "Connecting…" for up to 8s, then "Token invalid" if still not connected
function WsStatus({ token }: { token: string }) {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 20000);
    return () => { clearTimeout(t); setTimedOut(false); };
  }, [token]);
  return <>{timedOut ? <span className="text-red-400">Token expired — click Auto</span> : 'Connecting…'}</>;
}

// ── Leg type ──────────────────────────────────────────────────────────────────
interface Greeks { delta: number; theta: number; vega: number; gamma: number; iv: number; }
interface Leg {
  id: number;
  refId?: number;
  symbol: string;
  expiry: string;
  strike: number;
  type: 'CE' | 'PE';
  action: 'B' | 'S';
  lots: number;
  lotSize: number;     // contract lot size (e.g. 75 for NIFTY)
  price: number;       // entry LTP
  entrySpot: number;   // spot at time of entry
  entryTime: string;   // HH:MM:SS at time of entry
  currLtp: number;     // live LTP (updated from OC feed)
  checked: boolean;    // include in MTM total
  entryGreeks: Greeks; // greeks at entry
  currGreeks: Greeks;  // live greeks
}

// ── MTM Analyzer layout (resizable 40/60 split) ──────────────────────────────
const columnHelper = createColumnHelper<Leg>();
const fmtG = (v: number, dec = 4) => v === 0 ? '—' : Math.abs(v) < 0.0001 ? v.toExponential(2) : parseFloat(v.toFixed(dec)).toString();
const fmtMtm = (v: number): string => {
  const abs = Math.abs(v);
  const sign = v >= 0 ? '+' : '-';
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000)    return `${sign}₹${(abs / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000)       return `${sign}₹${(abs / 1_000).toFixed(2)}K`;
  return `${sign}₹${abs.toFixed(2)}`;
};
const fmtExpiry = (e: string) => new Date(`${e.slice(0, 4)}-${e.slice(4, 6)}-${e.slice(6, 8)}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' });
const greekItems: { key: keyof Greeks; label: string; name: string; color: string; dec: number }[] = [
  { key: 'delta', label: 'Δ', name: 'Delta', color: '#60a5fa', dec: 4 },
  { key: 'theta', label: 'Θ', name: 'Theta', color: '#f59e0b', dec: 2 },
  { key: 'vega',  label: 'V', name: 'Vega',  color: '#a78bfa', dec: 2 },
  { key: 'iv',    label: 'IV', name: 'IV',    color: '#34d399', dec: 2 },
  { key: 'gamma', label: 'Γ', name: 'Gamma', color: '#fb923c', dec: 5 },
];

function MtmGroupTable({ group, showGreeks, columns }: { group: { symbol: string; legs: Leg[] }, showGreeks: boolean, columns: any }) {
  const groupMtm = group.legs.filter(l => l.checked).reduce((sum, leg) => {
    const currLtp = leg.currLtp > 0 ? leg.currLtp : leg.price;
    const diff = currLtp - leg.price;
    return sum + (leg.action === 'B' ? diff : -diff) * leg.lots * (leg.lotSize || 1);
  }, 0);
  const mtmColor = groupMtm >= 0 ? '#26a69a' : '#f23645';
  const symbolColors: Record<string, { accent: string; bg: string }> = {
    NIFTY: { accent: '#60a5fa', bg: 'rgba(96,165,250,0.08)' },
    BANKNIFTY: { accent: '#a78bfa', bg: 'rgba(167,139,250,0.08)' },
    FINNIFTY: { accent: '#34d399', bg: 'rgba(52,211,153,0.08)' },
    SENSEX: { accent: '#fb923c', bg: 'rgba(251,146,60,0.08)' },
  };
  const sc = symbolColors[group.symbol] ?? { accent: '#9CA3AF', bg: 'rgba(255,255,255,0.04)' };

  const table = useReactTable({
    data: group.legs,
    columns,
    getCoreRowModel: getCoreRowModel()
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* Instrument group header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: sc.bg, border: `1px solid ${sc.accent}1a`, margin: '4px 0' }}>
        <div style={{ width: 4, height: 20, borderRadius: 2, background: sc.accent, flexShrink: 0 }} />
        <span style={{ fontSize: 14, fontWeight: 800, color: sc.accent, letterSpacing: '0.04em' }}>{group.symbol}</span>
        <span style={{ fontSize: 12, color: '#6B7280', fontWeight: 500, paddingLeft: 4 }}>{group.legs.length} leg{group.legs.length > 1 ? 's' : ''}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 16, fontWeight: 700, color: mtmColor, fontFamily: 'monospace' }}>{fmtMtm(groupMtm)}</span>
        <span style={{ fontSize: 11, color: '#6B7280', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>net mtm</span>
      </div>
      {/* TanStack Legs */}
      {showGreeks ? (
        table.getRowModel().rows.map(row => (
          <div key={row.id} style={{
            background: 'var(--bg-inset)',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.03)',
            display: 'flex',
            alignItems: 'stretch',
            opacity: row.original.checked ? 1 : 0.45,
            transition: 'opacity 0.2s',
          }}>
            {row.getVisibleCells().map(cell => (
              <React.Fragment key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </React.Fragment>
            ))}
          </div>
        ))
      ) : (
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 4px', tableLayout: 'fixed' }}>
          <colgroup>
            {table.getAllColumns().map(col => (
              <col key={col.id} style={{ width: col.getSize() }} />
            ))}
          </colgroup>
          <tbody>
            {table.getRowModel().rows.map(row => (
              <tr key={row.id} style={{ opacity: row.original.checked ? 1 : 0.45, transition: 'opacity 0.2s' }}>
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} style={{ padding: '0 3px', verticalAlign: 'middle' }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MtmLayout({ visible, workerRef, workerReady, workerModeRef, mtmResultsCbRef, instruments }: {
  visible: boolean;
  workerRef: React.RefObject<Worker | null>;
  workerReady: React.RefObject<boolean>;
  workerModeRef: React.RefObject<'header' | 'chart' | 'mtm'>;
  mtmResultsCbRef: React.RefObject<((results: Instrument[]) => void) | null>;
  instruments: Instrument[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftPct, setLeftPct] = useState(45);
  const dragging = useRef(false);

  const [legs, setLegs] = useState<Leg[]>([]);
  const legIdRef = useRef(0);
  const ocSpotRef = useRef(0); // latest spot from option chain feed
  const [showGreeks, setShowGreeks] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const ZERO_GREEKS: Greeks = { delta: 0, theta: 0, vega: 0, gamma: 0, iv: 0 };
  const addLeg = useCallback((leg: Omit<Leg, 'id' | 'entrySpot' | 'entryTime' | 'currLtp' | 'checked' | 'currGreeks' | 'entryGreeks'> & { greeks: Greeks }) => {
    const now = new Date();
    const entryTime = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const { greeks, ...rest } = leg;
    setLegs(prev => [...prev, { ...rest, id: ++legIdRef.current, entrySpot: ocSpotRef.current, entryTime, currLtp: leg.price, checked: true, entryGreeks: greeks, currGreeks: greeks, lotSize: rest.lotSize ?? 1 }]);
  }, []);

  const removeLeg = useCallback((id: number) => {
    setLegs(prev => prev.filter(l => l.id !== id));
  }, []);

  const updateLeg = useCallback((id: number, patch: Partial<Leg>) => {
    setLegs(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  }, []);

  // ── MTM Live Greeks WebSocket ────────────────────────────────────────────────
  const mtmWsRef = useRef<WebSocket | null>(null);
  
  useEffect(() => {
    const sessionToken = localStorage.getItem('nubra_session_token');
    if (!sessionToken || legs.length === 0) {
      if (mtmWsRef.current) { mtmWsRef.current.close(); mtmWsRef.current = null; }
      return;
    }

    const refIds = Array.from(new Set(legs.map(l => l.refId).filter((id): id is number => id !== undefined)));
    if (refIds.length === 0) return;

    if (!mtmWsRef.current || mtmWsRef.current.readyState !== WebSocket.OPEN) {
      if (mtmWsRef.current) mtmWsRef.current.close();
      const ws = new WebSocket('ws://localhost:8765');
      mtmWsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          action: 'subscribe',
          session_token: sessionToken,
          data_type: 'greeks',
          symbols: [],
          ref_ids: refIds,
          exchange: 'NSE', // Using NSE by default for options
        }));
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'greeks' && msg.data) {
            const d = msg.data;
            if (!d.ref_id) return;
            setLegs(prev => {
              let changed = false;
              const next = prev.map(leg => {
                if (leg.refId !== d.ref_id) return leg;
                changed = true;
                const newLtp = d.ltp !== undefined && d.ltp > 0 ? (d.ltp / 100) : leg.currLtp;
                const newGreeks = {
                  delta: d.delta ?? leg.currGreeks.delta,
                  theta: d.theta ?? leg.currGreeks.theta,
                  vega: d.vega ?? leg.currGreeks.vega,
                  gamma: d.gamma ?? leg.currGreeks.gamma,
                  iv: d.iv !== undefined && d.iv > 0 ? d.iv : leg.currGreeks.iv,
                };
                const entryGreeks = leg.entryGreeks.delta === 0 && newGreeks.delta !== 0 ? newGreeks : leg.entryGreeks;
                return { ...leg, currLtp: newLtp, currGreeks: newGreeks, entryGreeks };
              });
              return changed ? next : prev;
            });
          }
        } catch { /**/ }
      };
      
      ws.onerror = () => {};
      ws.onclose = () => { mtmWsRef.current = null; };
    } else {
      // If already connected, just send new subscription
      mtmWsRef.current.send(JSON.stringify({
        action: 'subscribe',
        session_token: sessionToken,
        data_type: 'greeks',
        symbols: [],
        ref_ids: refIds,
        exchange: 'NSE',
      }));
    }

    // Note: We intentionally don't close the WS on every dependency change to avoid rapid reconnects.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs.map(l => l.refId).join(',')]);


  const stdColumns = useMemo(() => [
    columnHelper.display({
      id: 'check', size: 28,
      header: () => <span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 700 }}></span>,
      cell: ({ row }) => {
        const leg = row.original;
        return (
          <div onClick={() => updateLeg(leg.id, { checked: !leg.checked })}
            style={{ width: 18, height: 18, borderRadius: 4, background: leg.checked ? 'rgba(129,140,248,0.15)' : 'rgba(255,255,255,0.03)', border: `1px solid ${leg.checked ? 'rgba(129,140,248,0.5)' : 'rgba(255,255,255,0.12)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            {leg.checked && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </div>
        );
      }
    }),
    columnHelper.display({
      id: 'action', size: 36,
      header: () => <span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 700 }}>B/S</span>,
      cell: ({ row }) => {
        const leg = row.original; const isBuy = leg.action === 'B';
        return (
          <div onClick={() => updateLeg(leg.id, { action: isBuy ? 'S' : 'B' })}
            style={{ width: 28, height: 26, borderRadius: 5, background: isBuy ? 'rgba(38,166,154,0.15)' : 'rgba(242,54,69,0.15)', border: `1px solid ${isBuy ? 'rgba(38,166,154,0.45)' : 'rgba(242,54,69,0.45)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: isBuy ? '#26a69a' : '#f23645' }}>{leg.action}</span>
          </div>
        );
      }
    }),
    columnHelper.display({
      id: 'type', size: 44,
      header: () => <span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 700 }}>Type</span>,
      cell: ({ row }) => {
        const leg = row.original;
        return (
          <div style={{ width: 36, height: 26, borderRadius: 5, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: leg.type === 'CE' ? '#facc15' : '#c084fc' }}>{leg.type}</span>
          </div>
        );
      }
    }),
    columnHelper.display({
      id: 'lots', size: 96,
      header: () => <span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 700 }}>Lots</span>,
      cell: ({ row }) => (
        <div style={{ width: 88, height: 26, display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 5, overflow: 'hidden' }}>
          <button onClick={() => updateLeg(row.original.id, { lots: Math.max(1, row.original.lots - 1) })} style={{ width: 22, height: 26, background: 'transparent', border: 'none', color: '#6B7280', cursor: 'pointer', fontSize: 14, lineHeight: 1, flexShrink: 0 }}>−</button>
          <input type="text" inputMode="numeric"
            key={`lots-${row.original.id}-${row.original.lots}`}
            defaultValue={row.original.lots}
            onBlur={e => { const v = parseInt(e.target.value); const safe = isNaN(v) || v < 1 ? 1 : v; e.target.value = String(safe); updateLeg(row.original.id, { lots: safe }); }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#E2E8F0', background: 'transparent', border: 'none', outline: 'none', minWidth: 0, width: 0 }} />
          <button onClick={() => updateLeg(row.original.id, { lots: row.original.lots + 1 })} style={{ width: 22, height: 26, background: 'transparent', border: 'none', color: '#6B7280', cursor: 'pointer', fontSize: 14, lineHeight: 1, flexShrink: 0 }}>+</button>
        </div>
      )
    }),
    columnHelper.display({
      id: 'expiry', size: 90,
      header: () => <span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 700 }}>Expiry</span>,
      cell: ({ row }) => (
        <div style={{ height: 26, borderRadius: 5, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>
          <span style={{ fontSize: 13, color: '#9CA3AF', fontWeight: 500, whiteSpace: 'nowrap' }}>{fmtExpiry(row.original.expiry)}</span>
        </div>
      )
    }),
    columnHelper.display({
      id: 'strike', size: 72,
      header: () => <span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 700 }}>Strike</span>,
      cell: ({ row }) => (
        <div style={{ height: 26, borderRadius: 5, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#60a5fa', fontFamily: 'monospace' }}>{row.original.strike}</span>
        </div>
      )
    }),
    columnHelper.display({
      id: 'price', size: 80,
      header: () => <span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 700 }}>Price</span>,
      cell: ({ row }) => (
        <div style={{ height: 26, borderRadius: 5, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#D1D4DC', fontFamily: 'monospace' }}>₹{row.original.price.toFixed(2)}</span>
        </div>
      )
    }),
    columnHelper.display({
      id: 'currLtp', size: 80,
      header: () => <span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 700 }}>LTP</span>,
      cell: ({ row }) => (
        <div style={{ height: 26, borderRadius: 5, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#E2E8F0', fontFamily: 'monospace' }}>₹{(row.original.currLtp > 0 ? row.original.currLtp : row.original.price).toFixed(2)}</span>
        </div>
      )
    }),
    columnHelper.display({
      id: 'spot', size: 80,
      header: () => <span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 700 }}>Spot</span>,
      cell: ({ row }) => (
        <div style={{ height: 26, borderRadius: 5, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#6B7280', fontFamily: 'monospace' }}>{row.original.entrySpot > 0 ? row.original.entrySpot.toFixed(2) : '—'}</span>
        </div>
      )
    }),
    columnHelper.display({
      id: 'time', size: 72,
      header: () => <span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 700 }}>Time</span>,
      cell: ({ row }) => (
        <div style={{ height: 26, borderRadius: 5, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#6B7280' }}>{row.original.entryTime}</span>
        </div>
      )
    }),
    columnHelper.display({
      id: 'mtm', size: 88,
      header: () => <span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 700 }}>MTM</span>,
      cell: ({ row }) => {
        const leg = row.original;
        const currLtp = leg.currLtp > 0 ? leg.currLtp : leg.price;
        const mtm = (leg.action === 'B' ? currLtp - leg.price : leg.price - currLtp) * leg.lots * (leg.lotSize || 1);
        const pos = mtm >= 0;
        return (
          <div style={{ height: 26, borderRadius: 5, background: pos ? 'rgba(38,166,154,0.1)' : 'rgba(242,54,69,0.1)', border: `1px solid ${pos ? 'rgba(38,166,154,0.25)' : 'rgba(242,54,69,0.25)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: pos ? '#26a69a' : '#f23645', fontFamily: 'monospace' }}>{fmtMtm(mtm)}</span>
          </div>
        );
      }
    }),
    columnHelper.display({
      id: 'delete', size: 32,
      header: () => <span />,
      cell: ({ row }) => (
        <button onClick={() => removeLeg(row.original.id)}
          style={{ width: 24, height: 24, background: 'transparent', border: 'none', cursor: 'pointer', color: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }}
          onMouseEnter={e => (e.currentTarget.style.color = '#f23645')}
          onMouseLeave={e => (e.currentTarget.style.color = '#374151')}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></svg>
        </button>
      )
    }),
  ], [updateLeg, removeLeg]);

  const greeksColumns = useMemo(() => [
    columnHelper.display({ id: 'position', header: () => <div style={{ width: 90, paddingLeft: 10, flexShrink: 0, display: 'flex', alignItems: 'center' }}><span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Position</span></div>, cell: ({ row }) => { const leg = row.original; const isBuy = leg.action === 'B'; return <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, padding: '8px 10px', borderRight: '1px solid rgba(255,255,255,0.05)', flexShrink: 0, width: 90, background: 'rgba(0,0,0,0.12)' }}><div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div onClick={() => updateLeg(leg.id, { checked: !leg.checked })} style={{ width: 14, height: 14, borderRadius: 3, background: leg.checked ? 'rgba(129,140,248,0.2)' : 'rgba(255,255,255,0.04)', border: `1px solid ${leg.checked ? 'rgba(129,140,248,0.6)' : 'rgba(255,255,255,0.15)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}>{leg.checked && <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}</div><div onClick={() => updateLeg(leg.id, { action: leg.action === 'B' ? 'S' : 'B' })} style={{ padding: '0px 6px', height: 18, borderRadius: 3, background: isBuy ? 'rgba(38,166,154,0.15)' : 'rgba(242,54,69,0.15)', border: `1px solid ${isBuy ? 'rgba(38,166,154,0.4)' : 'rgba(242,54,69,0.4)'}`, cursor: 'pointer', display: 'flex', alignItems: 'center' }}><span style={{ fontSize: 11, fontWeight: 800, color: isBuy ? '#26a69a' : '#f23645' }}>{leg.action}</span></div><span style={{ fontSize: 11, fontWeight: 800, color: leg.type === 'CE' ? '#facc15' : '#c084fc', letterSpacing: '0.02em' }}>{leg.type}</span></div><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 13, fontWeight: 800, color: '#E2E8F0', fontFamily: 'monospace', lineHeight: 1 }}>{leg.strike}</span><div style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '2px 5px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 700, fontFamily: 'monospace', lineHeight: 1 }}>{leg.lots}x</span></div></div></div>; } }),
    ...greekItems.map((gk, gi) => columnHelper.display({ id: gk.key, header: () => <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, padding: '0 6px', alignItems: 'center' }}><div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}><span style={{ fontSize: 13, color: gk.color, fontWeight: 800, letterSpacing: '0.02em' }}>{gk.label}</span><span style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{gk.name}</span></div><div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', padding: '0 2px' }}><span style={{ fontSize: 10, color: 'rgba(156,163,175,0.5)', fontWeight: 600, letterSpacing: '0.03em' }}>Ent</span><span style={{ fontSize: 10, color: 'rgba(156,163,175,0.7)', fontWeight: 700, letterSpacing: '0.03em' }}>Live</span></div></div>, cell: ({ row }) => { const leg = row.original; const isIv = gk.key === 'iv'; const rawCurr = leg.currGreeks[gk.key]; const rawEntry = leg.entryGreeks[gk.key]; const curr = isIv ? rawCurr * 100 : rawCurr; const entry = isIv ? rawEntry * 100 : rawEntry; const chg = curr - entry; const chgColor = chg > 0 ? '#26a69a' : chg < 0 ? '#f23645' : '#6B7280'; return <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '4px 6px', borderRight: gi < 4 ? '1px solid rgba(255,255,255,0.12)' : 'none', height: '100%', gap: 2 }}><div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: 12, color: '#9CA3AF', fontFamily: 'monospace', fontWeight: 600 }}>{fmtG(entry, gk.dec)}{isIv ? '%' : ''}</span><span style={{ fontSize: 14, fontWeight: 800, color: gk.color, fontFamily: 'monospace' }}>{fmtG(curr, gk.dec)}{isIv ? '%' : ''}</span></div><div style={{ display: 'flex', justifyContent: 'center' }}><span style={{ fontSize: 13, fontWeight: 700, color: chgColor, fontFamily: 'monospace' }}>{entry !== 0 ? `${chg >= 0 ? '+' : ''}${parseFloat(chg.toFixed(gk.dec))}${isIv ? '%' : ''}` : '—'}</span></div></div>; } })),
    columnHelper.display({ id: 'delete', header: () => <div style={{ width: 34, flexShrink: 0 }} />, cell: ({ row }) => <div style={{ display: 'flex', alignItems: 'center', padding: '0 6px', borderLeft: '1px solid rgba(255,255,255,0.03)', flexShrink: 0, height: '100%' }}><button onClick={() => removeLeg(row.original.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#1f2937', display: 'flex', alignItems: 'center', padding: 2, borderRadius: 4 }} onMouseEnter={e => (e.currentTarget.style.color = '#f23645')} onMouseLeave={e => (e.currentTarget.style.color = '#1f2937')}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></svg></button></div> })
  ], [updateLeg, removeLeg]);

  const headerTable = useReactTable({
    data: [],
    columns: showGreeks ? greeksColumns : stdColumns,
    getCoreRowModel: getCoreRowModel()
  });

  // Called by OptionChain on every data tick — update currLtp + live greeks for matching legs
  const onLtpUpdate = useCallback((ltpMap: Map<number, { ce: number; pe: number; ceGreeks: Greeks; peGreeks: Greeks }>, spot: number, chainExpiry: string) => {
    ocSpotRef.current = spot;
    setLegs(prev => prev.map(leg => {
      // Only update legs that match the Option Chain's current expiry
      if (leg.expiry !== chainExpiry) return leg;

      // Try exact match first, then scan for closest key (handles float precision)
      let entry = ltpMap.get(leg.strike);
      if (!entry) {
        for (const [k, v] of ltpMap.entries()) {
          if (Math.abs(k - leg.strike) < 0.01) { entry = v; break; }
        }
      }
      if (!entry) return leg;
      const newLtp = leg.type === 'CE' ? entry.ce : entry.pe;
      const newGreeks = leg.type === 'CE' ? entry.ceGreeks : entry.peGreeks;
      // Set entryGreeks once (when they're still zero)
      const entryGreeks = leg.entryGreeks.delta === 0 && newGreeks.delta !== 0 ? newGreeks : leg.entryGreeks;
      return { ...leg, currLtp: newLtp, currGreeks: newGreeks, entryGreeks };
    }));
  }, []);

  // Selected instrument for option chain
  const [ocSymbol, setOcSymbol] = useState('');
  const [ocAssetType, setOcAssetType] = useState<'INDEX_FO' | 'STOCK_FO' | ''>('');
  const [ocExchange, setOcExchange] = useState<string>('NSE');
  const [ocOpen, setOcOpen] = useState(false);
  const nubraSession = localStorage.getItem('nubra_session_token') ?? '';

  // Nubra instruments from IndexedDB cache — for expiry list
  const [nubraInstruments, setNubraInstruments] = useState<NubraInstrument[]>([]);
  const [nubraIndexes, setNubraIndexes] = useState<Record<string, string>[]>([]);
  useEffect(() => {
    loadNubraInstruments().then(cached => {
      if (!cached) return;
      try {
        const parsed = JSON.parse(cached.data);
        setNubraInstruments(parsed.refdata ?? parsed);
        setNubraIndexes(parsed.indexes ?? []);
      } catch { /* ignore */ }
    });
  }, []);

  // Compute sorted expiries from Nubra instruments
  // NubraInstrument fields: asset, stock_name, nubra_name, derivative_type, option_type, expiry (YYYYMMDD int)
  const ocExpiries = useMemo(() => {
    if (!ocSymbol) return [];
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const sym = ocSymbol.toUpperCase();
    const expSet = new Set<string>();
    for (const i of nubraInstruments) {
      // Only options (CE/PE)
      if ((i.option_type !== 'CE' && i.option_type !== 'PE') || !i.expiry) continue;
      if (ocAssetType && i.asset_type !== ocAssetType) continue;
      if (i.exchange !== ocExchange) continue;
      // Match by asset name (primary) OR stock_name prefix OR nubra_name
      const asset = (i.asset ?? '').toUpperCase();
      const stockName = (i.stock_name ?? '').toUpperCase();
      const nubraName = (i.nubra_name ?? '').toUpperCase();
      const matches = asset === sym || nubraName === sym || stockName === sym;
      if (matches) {
        const expStr = String(i.expiry);
        if (expStr >= todayStr) expSet.add(expStr);
      }
    }
    return [...expSet].sort();
  }, [ocSymbol, ocAssetType, ocExchange, nubraInstruments]);

  // Lot size for the selected OC symbol
  const ocLotSize = useMemo(() => {
    if (!ocSymbol) return 1;
    const sym = ocSymbol.toUpperCase();
    const match = nubraInstruments.find(i =>
      (i.option_type === 'CE' || i.option_type === 'PE') &&
      ((i.asset ?? '').toUpperCase() === sym || (i.nubra_name ?? '').toUpperCase() === sym || (i.stock_name ?? '').toUpperCase() === sym)
    );
    return match?.lot_size ?? 1;
  }, [ocSymbol, nubraInstruments]);

  // Search state
  const [mtmQuery, setMtmQuery] = useState('');
  const [mtmResults, setMtmResults] = useState<Instrument[]>([]);
  const [mtmTab, setMtmTab] = useState<Tab>('ALL');
  const [mtmCursor, setMtmCursor] = useState(0);
  const [showMtmDropdown, setShowMtmDropdown] = useState(false);
  const mtmInputRef = useRef<HTMLInputElement>(null);
  const mtmDropdownRef = useRef<HTMLDivElement>(null);
  const mtmDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mtmListRef = useRef<HTMLDivElement>(null);

  // Register callback so App's worker handler can push results here
  useEffect(() => {
    mtmResultsCbRef.current = (results: Instrument[]) => {
      setMtmResults(results);
      setShowMtmDropdown(true);
      setMtmCursor(0);
    };
    return () => { mtmResultsCbRef.current = null; };
  }, [mtmResultsCbRef]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!mtmInputRef.current?.contains(e.target as Node) && !mtmDropdownRef.current?.contains(e.target as Node)) {
        setShowMtmDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleMtmSearch = useCallback((v: string) => {
    setMtmQuery(v);
    setMtmCursor(0);
    if (mtmDebounce.current) clearTimeout(mtmDebounce.current);
    if (!v.trim()) { setMtmResults([]); setShowMtmDropdown(false); return; }
    mtmDebounce.current = setTimeout(() => {
      if (workerRef.current && workerReady.current) {
        workerModeRef.current = 'mtm';
        workerRef.current.postMessage({ type: 'SEARCH', query: v });
      }
    }, 150);
  }, [workerRef, workerReady, workerModeRef]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setLeftPct(Math.min(Math.max(pct, 15), 85));
    };
    const onUp = () => { dragging.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 flex"
      style={{ display: visible ? 'flex' : 'none', padding: 12, gap: 12, background: 'var(--bg-base)' }}
    >
      {/* Left panel */}
      <div style={{ width: `${leftPct}%`, background: '#171717', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {/* Search bar + dropdown */}
        <div style={{ padding: '12px 14px', position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: '55%', position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '0 12px', height: 36, transition: 'all 0.2s', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#565A6B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
              <input
                ref={mtmInputRef}
                value={mtmQuery}
                onChange={e => handleMtmSearch(e.target.value)}
                onKeyDown={e => {
                  const list = filterByTab(mtmResults.filter(i => i.instrument_type === 'EQ' || i.instrument_type === 'INDEX' || i.instrument_type === 'FUT'), mtmTab);
                  if (e.key === 'ArrowDown') { e.preventDefault(); setMtmCursor(c => Math.min(c + 1, list.length - 1)); mtmListRef.current?.children[mtmCursor + 1]?.scrollIntoView({ block: 'nearest' }); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setMtmCursor(c => Math.max(c - 1, 0)); mtmListRef.current?.children[mtmCursor - 1]?.scrollIntoView({ block: 'nearest' }); }
                  else if (e.key === 'Enter' && list.length > 0) { const sel = list[mtmCursor]; setMtmQuery(sel.trading_symbol); setShowMtmDropdown(false); setOcSymbol(sel.underlying_symbol || sel.trading_symbol); setOcAssetType(sel.instrument_type === 'INDEX' ? 'INDEX_FO' : 'STOCK_FO'); setOcExchange(sel.exchange ?? 'NSE'); setOcOpen(true); }
                  else if (e.key === 'Escape') { setShowMtmDropdown(false); }
                }}
                placeholder="Search instruments..."
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 13, color: '#E2E8F0', caretColor: '#818cf8', fontWeight: 500 }}
              />
              {mtmQuery && <button onClick={() => { setMtmQuery(''); setMtmResults([]); setShowMtmDropdown(false); }} style={{ background: 'rgba(255,255,255,0.07)', border: 'none', cursor: 'pointer', color: '#787B86', display: 'flex', padding: 3, borderRadius: 4 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg></button>}
            </div>
            {/* Dropdown */}
            {showMtmDropdown && (
              <div ref={mtmDropdownRef} style={{ position: 'absolute', top: '100%', left: 12, right: 12, zIndex: 999, background: '#1f1f1f', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 340 }}>
                {/* Tab pills */}
                <div style={{ display: 'flex', gap: 4, padding: '8px 12px', flexWrap: 'wrap', flexShrink: 0 }}>
                  {(['ALL', 'Cash'] as Tab[]).map(t => (
                    <button key={t} onClick={() => { setMtmTab(t); setMtmCursor(0); }} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, border: '1px solid', cursor: 'pointer', background: mtmTab === t ? 'rgba(79,142,247,0.15)' : 'transparent', borderColor: mtmTab === t ? 'rgba(79,142,247,0.4)' : 'rgba(255,255,255,0.08)', color: mtmTab === t ? '#4F8EF7' : '#565A6B' }}>{t}</button>
                  ))}
                </div>
                <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', flexShrink: 0 }} />
                {/* Results list */}
                <div ref={mtmListRef} style={{ overflowY: 'auto', flex: 1, scrollbarWidth: 'thin', scrollbarColor: '#2a2a2a transparent' }}>
                  {filterByTab(mtmResults.filter(i => i.instrument_type === 'EQ' || i.instrument_type === 'INDEX' || i.instrument_type === 'FUT'), mtmTab).length === 0 ? (
                    <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12, color: '#3D4150' }}>No results for "{mtmQuery}"</div>
                  ) : filterByTab(mtmResults.filter(i => i.instrument_type === 'EQ' || i.instrument_type === 'INDEX' || i.instrument_type === 'FUT'), mtmTab).map((ins, i) => (
                    <div key={ins.instrument_key}
                      onClick={() => { setMtmQuery(ins.trading_symbol); setShowMtmDropdown(false); setOcSymbol(ins.underlying_symbol || ins.trading_symbol); setOcAssetType(ins.instrument_type === 'INDEX' ? 'INDEX_FO' : 'STOCK_FO'); setOcExchange(ins.exchange ?? 'NSE'); setOcOpen(true); }}
                      onMouseEnter={() => setMtmCursor(i)}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.03)', background: i === mtmCursor ? 'rgba(79,142,247,0.10)' : 'transparent', transition: 'background 0.08s' }}
                    >
                      <div style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 7, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {ins.exchange === 'NSE' ? <img src="https://s3-symbol-logo.tradingview.com/source/NSE.svg" alt="NSE" style={{ width: 20, height: 20, objectFit: 'contain', opacity: 0.85 }} />
                          : ins.exchange === 'BSE' ? <img src="https://s3-symbol-logo.tradingview.com/source/BSE.svg" alt="BSE" style={{ width: 20, height: 20, objectFit: 'contain', opacity: 0.85 }} />
                            : <span style={{ fontSize: 9, fontWeight: 700, color: '#9598A1' }}>{ins.exchange}</span>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#E0E3EB' }}><Highlight text={ins.trading_symbol} query={mtmQuery} /></div>
                        <div style={{ fontSize: 11, color: '#565A6B', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><Highlight text={ins.name} query={mtmQuery} /></div>
                      </div>
                      <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(255,255,255,0.05)', color: '#565A6B', fontWeight: 600, textTransform: 'uppercase', flexShrink: 0 }}>{ins.instrument_type}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)', flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: '#4A4E5C' }}><kbd style={{ fontFamily: 'monospace' }}>↵</kbd> select</span>
                  <span style={{ fontSize: 11, color: '#4A4E5C' }}><kbd style={{ fontFamily: 'monospace' }}>Esc</kbd> close</span>
                </div>
              </div>
            )}
          </div>
          {/* Settings button */}
          <button onClick={() => setSettingsOpen(true)} style={{ flexShrink: 0, width: 36, height: 36, background: settingsOpen ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.2s' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
            onMouseLeave={e => (e.currentTarget.style.background = settingsOpen ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 14 14" fill="none"><g clipPath="url(#mtm-settings-clip)"><path fillRule="evenodd" clipRule="evenodd" d="M5.09373 0.995125C5.16241 0.427836 5.64541 0 6.21747 0H7.43151C8.0039 0 8.48663 0.428191 8.55525 0.996829C8.5553 0.997248 8.55536 0.997666 8.5554 0.9981L8.65947 1.81525C8.80015 1.86677 8.93789 1.92381 9.07227 1.98601L9.72415 1.47911C10.1776 1.12819 10.8237 1.16381 11.2251 1.57622L12.0753 2.42643C12.4854 2.82551 12.5214 3.47159 12.1697 3.92431L11.6628 4.57692C11.725 4.71124 11.782 4.84882 11.8335 4.98924L12.6526 5.09337C12.653 5.09342 12.6534 5.09348 12.6539 5.09352C13.2211 5.16221 13.6492 5.64522 13.6484 6.21766V7.4312C13.6484 8.00358 13.2203 8.48622 12.6517 8.5549C12.6513 8.55496 12.6508 8.55502 12.6503 8.55506L11.8338 8.65909C11.7824 8.7996 11.7254 8.93729 11.663 9.07168L12.1696 9.72354C12.5218 10.1776 12.4847 10.823 12.0728 11.2245L11.2224 12.0749C10.8233 12.485 10.1772 12.5209 9.72452 12.1692L9.07187 11.6624C8.93756 11.7246 8.79995 11.7815 8.65952 11.833L8.55539 12.6521C8.55533 12.6525 8.55528 12.653 8.55522 12.6534C8.48652 13.2206 8.00353 13.6484 7.43151 13.6484H6.21747C5.64485 13.6484 5.16232 13.22 5.09373 12.6506C5.09367 12.6501 5.09361 12.6496 5.09355 12.6491L4.98954 11.8328C4.84901 11.7814 4.71133 11.7244 4.57692 11.662L3.92477 12.1688C3.47111 12.5199 2.82587 12.4838 2.42408 12.0724L1.57358 11.2219C1.16354 10.8229 1.12761 10.1769 1.47927 9.72417L1.98614 9.0715C1.92397 8.93721 1.86696 8.7996 1.81546 8.65919L0.996348 8.55505C0.995929 8.555 0.995526 8.55494 0.995107 8.5549C0.427838 8.48619 0 8.00325 0 7.4312V6.21724C0 5.64481 0.428228 5.16211 0.996871 5.09351L1.81538 4.98929C1.86677 4.84897 1.92362 4.7113 1.98597 4.5768L1.47915 3.92465C1.12701 3.47063 1.1643 2.82485 1.57625 2.42329L2.42671 1.57338C2.82634 1.16348 3.47226 1.12815 3.92438 1.4792L4.57644 1.98589C4.71105 1.92352 4.84888 1.86662 4.98946 1.81519L5.09373 0.995125ZM6.82448 4.43525C5.50742 4.43525 4.43541 5.50723 4.43541 6.82422C4.43541 8.14119 5.50742 9.21317 6.82448 9.21317C8.14154 9.21317 9.21356 8.14119 9.21356 6.82422C9.21356 5.50723 8.14154 4.43525 6.82448 4.43525ZM3.79381 6.82422C3.79381 5.15287 5.15311 3.79365 6.82448 3.79365C8.49586 3.79365 9.85515 5.15287 9.85515 6.82422C9.85515 8.49556 8.49586 9.85477 6.82448 9.85477C5.15311 9.85477 3.79381 8.49556 3.79381 6.82422Z" fill="#9CA3AF" /></g><defs><clipPath id="mtm-settings-clip"><rect width="14" height="14" fill="white" /></clipPath></defs></svg>
          </button>
        </div>
        {/* Settings modal */}
        {settingsOpen && (
          <div style={{ position: 'absolute', top: 44, left: 8, zIndex: 100, background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '14px 16px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)', minWidth: 220 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#E2E8F0', letterSpacing: '0.04em' }}>Display Settings</span>
              <button onClick={() => setSettingsOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4B5563', display: 'flex', padding: 0 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#D1D4DC' }}>Show Greeks</div>
                <div style={{ fontSize: 11, color: '#4B5563', marginTop: 2 }}>Delta, Theta, Vega, IV, Gamma</div>
              </div>
              {/* Toggle */}
              <div onClick={() => setShowGreeks(g => !g)} style={{ width: 36, height: 20, borderRadius: 10, background: showGreeks ? '#26a69a' : 'rgba(255,255,255,0.1)', border: `1px solid ${showGreeks ? '#26a69a' : 'rgba(255,255,255,0.15)'}`, cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: 2, left: showGreeks ? 18 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }} />
              </div>
            </div>
          </div>
        )}
        {/* Separator */}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.04)', margin: '0 14px 10px 4px' }} />
        {/* Leg rows table */}
        <div style={{ flex: 1, padding: '0 10px 14px 10px', overflowX: 'auto', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#2a2a2a transparent' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Shared column header row */}
            {showGreeks ? (
              <div style={{ background: '#333333', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 0, padding: '8px 11px' }}>
                {headerTable.getHeaderGroups().map(hg => (
                  <React.Fragment key={hg.id}>
                    {hg.headers.map(h => (
                      <React.Fragment key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</React.Fragment>
                    ))}
                  </React.Fragment>
                ))}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <colgroup>
                  {headerTable.getAllColumns().map(col => (
                    <col key={col.id} style={{ width: col.getSize() }} />
                  ))}
                </colgroup>
                <thead>
                  {headerTable.getHeaderGroups().map(hg => (
                    <tr key={hg.id} style={{ background: '#333333', borderRadius: 6 }}>
                      {hg.headers.map(h => (
                        <th key={h.id} style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 700, fontSize: 11, color: '#9CA3AF', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
              </table>
            )}
            {legs.length === 0 && (
              <div style={{ padding: '24px', textAlign: 'center', color: '#3D4150', fontSize: 13 }}>
                No legs yet — click B or S on the option chain to add
              </div>
            )}
            {(() => {
              // Group legs by symbol
              const groups: { symbol: string; legs: Leg[] }[] = [];
              for (const leg of legs) {
                const g = groups.find(g => g.symbol === leg.symbol);
                if (g) g.legs.push(leg);
                else groups.push({ symbol: leg.symbol, legs: [leg] });
              }
              return groups.map(group => (
                <MtmGroupTable key={group.symbol} group={group} showGreeks={showGreeks} columns={showGreeks ? greeksColumns : stdColumns} />
              ));
            })()}

            {/* Add Legs button */}
            {ocSymbol && (
              <div style={{ padding: '8px 10px 4px' }}>
                <button
                  onClick={() => setOcOpen(true)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 7,
                    padding: '7px 20px',
                    background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                    border: 'none',
                    borderRadius: 7,
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: '0.03em',
                    cursor: 'pointer',
                    transition: 'opacity 0.15s, transform 0.1s',
                    width: 'fit-content',
                    boxShadow: '0 2px 8px rgba(37,99,235,0.35)',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.opacity = '0.88';
                    (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.opacity = '1';
                    (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
                  }}
                  onMouseDown={e => {
                    (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
                    (e.currentTarget as HTMLButtonElement).style.opacity = '0.75';
                  }}
                  onMouseUp={e => {
                    (e.currentTarget as HTMLButtonElement).style.opacity = '0.88';
                    (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M5.5 1v9M1 5.5h9" />
                  </svg>
                  Add Legs
                </button>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* OC toggle tab — floats on right edge of left panel, outside overflow:hidden */}
      {ocSymbol && (
        <button
          onClick={() => setOcOpen(o => !o)}
          title={ocOpen ? 'Close Option Chain' : 'Open Option Chain'}
          style={{
            position: 'absolute',
            left: `calc(${leftPct}% + 8px - 1px)`,
            top: '50%', transform: 'translateY(-50%)',
            width: 18, height: 64, zIndex: 60,
            background: ocOpen ? 'rgba(79,142,247,0.25)' : 'rgba(30,34,48,0.95)',
            border: '1px solid',
            borderLeft: 'none',
            borderColor: ocOpen ? 'rgba(79,142,247,0.6)' : 'rgba(255,255,255,0.12)',
            borderRadius: '0 6px 6px 0',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke={ocOpen ? '#4F8EF7' : '#565A6B'} strokeWidth="2" strokeLinecap="round">
            <path d={ocOpen ? 'M7 2L3 5l4 3' : 'M3 2l4 3-4 3'} />
          </svg>
        </button>
      )}

      {/* Option Chain — floats OVER left panel, anchored to its right side */}
      {ocOpen && ocSymbol && (
        <div style={{
          position: 'absolute',
          left: `calc(${leftPct}% + 8px - 800px)`,
          top: 8, bottom: 8,
          width: 800, zIndex: 55,
          background: '#171717',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 10,
          boxShadow: '0 8px 56px rgba(0,0,0,0.8)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <OptionChain symbol={ocSymbol} expiries={ocExpiries} sessionToken={nubraSession} exchange={ocExchange} onClose={() => setOcOpen(false)} onAddLeg={addLeg} onLtpUpdateRef={{ current: onLtpUpdate }} lotSize={ocLotSize} />
        </div>
      )}

      {/* Divider — 12px gap, draggable, no visible line */}
      <div
        onMouseDown={onMouseDown}
        onDoubleClick={() => setLeftPct(40)}
        style={{ width: 12, flexShrink: 0, cursor: 'col-resize' }}
      />

      {/* Right panel — Strategy Chart */}
      <div style={{ flex: 1, background: '#171717', borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
        <StrategyChart legs={legs} ocSymbol={ocSymbol} ocExchange={ocExchange} nubraInstruments={nubraInstruments} nubraIndexes={nubraIndexes} />
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const { instruments, status } = useInstruments();
  const [page, setPage] = useState<Page>('chart');
  // Tracks which pages have been visited — lazy-mount keep-alive pattern.
  // Once a page is visited it is never unmounted (state + WS survive tab switches).
  const [visited, setVisited] = useState<Set<Page>>(() => new Set<Page>(['chart']));
  const navigateTo = useCallback((p: Page) => { setVisited(prev => { const next = new Set(prev); next.add(p); return next; }); setPage(p); }, []);
  // ── Multi-pane workspace ────────────────────────────────────────────────────
  const { state: workspaceState, dispatch: workspaceDispatch } = useWorkspaceState(instruments);
  // Tracks which pane is currently "active" (last clicked) — navbar search routes here
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const activePaneIdRef = useRef<string | null>(null);
  // Sync ref with state
  const setActivePane = (id: string | null) => {
    activePaneIdRef.current = id;
    setActivePaneId(id);
  };
  // When a pane opens chart search, this routes the selection back to that pane
  const paneSearchCallbackRef = useRef<((ins: Instrument) => void) | null>(null);

  // ── Chart symbol search modal (TradingView-style) ──────────────────────────
  const [showChartSearch, setShowChartSearch] = useState(false);
  const [chartSearchQuery, setChartSearchQuery] = useState('');
  const [chartSearchResults, setChartSearchResults] = useState<Instrument[]>([]);
  const [chartSearchTab, setChartSearchTab] = useState<Tab>('ALL');
  const [chartSearchCursor, setChartSearchCursor] = useState(0);
  const chartSearchListRef = useRef<HTMLDivElement>(null);
  const chartSearchInputRef = useRef<HTMLInputElement>(null);

  const [token, setToken] = useState(() => localStorage.getItem('upstox_token') ?? '');
  const [tokenInput, setTokenInput] = useState(() => localStorage.getItem('upstox_token') ?? '');
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [autoLoginLoading, setAutoLoginLoading] = useState(false);
  const [autoLoginError, setAutoLoginError] = useState('');
  const isConnected = useWsConnected();

  const [showNubraPanel, setShowNubraPanel] = useState(false);
  const [nubraPhone, setNubraPhone] = useState(() => localStorage.getItem('nubra_phone') ?? '');
  const [nubraMpin, setNubraMpin] = useState(() => localStorage.getItem('nubra_mpin') ?? '');
  const [nubraTotpSecret, setNubraTotpSecret] = useState(() => localStorage.getItem('nubra_totp_secret') ?? '');
  const [nubraSession, setNubraSession] = useState(() => localStorage.getItem('nubra_session_token') ?? '');
  const [nubraLogging, setNubraLogging] = useState(false);
  const [nubraError, setNubraError] = useState('');
  const [setupStep, setSetupStep] = useState<'phone' | 'otp' | 'done'>('phone');
  const [setupOtp, setSetupOtp] = useState('');
  const [setupTempToken, setSetupTempToken] = useState('');

  const nubraLoggedIn = !!nubraSession;
  const hasSecret = !!nubraTotpSecret;

  const [showCookieInput, setShowCookieInput] = useState(false);
  const [cookieInput, setCookieInput] = useState(() => localStorage.getItem('nubra_raw_cookie') ?? '');
  const nubraHasCookie = !!(localStorage.getItem('nubra_raw_cookie') ?? '').trim();

  const handleNubraLogin = useCallback(async () => {
    if (!nubraPhone || !nubraMpin || !nubraTotpSecret) { setNubraError('Setup required first'); return; }
    setNubraLogging(true); setNubraError('');
    try {
      const res = await fetch('/api/nubra-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: nubraPhone, mpin: nubraMpin, totp_secret: nubraTotpSecret }) });
      const data = await res.json();
      if (!res.ok || !data.session_token) { setNubraError(data.error ?? data.detail?.message ?? 'Login failed'); setNubraLogging(false); return; }
      localStorage.setItem('nubra_session_token', data.session_token);
      localStorage.setItem('nubra_auth_token', data.auth_token);
      if (data.device_id) localStorage.setItem('nubra_device_id', data.device_id);
      localStorage.setItem('nubra_raw_cookie', `authToken=${data.auth_token}; sessionToken=${data.session_token}`);
      setNubraSession(data.session_token); setShowNubraPanel(false);
    } catch (e) { setNubraError(e instanceof Error ? e.message : 'Network error'); }
    setNubraLogging(false);
  }, [nubraPhone, nubraMpin, nubraTotpSecret]);

  const handleNubraSendOtp = useCallback(async () => {
    if (!nubraPhone) { setNubraError('Enter phone number'); return; }
    setNubraLogging(true); setNubraError('');
    try {
      const res = await fetch('/api/nubra-send-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: nubraPhone }) });
      const data = await res.json();
      if (!res.ok || !data.temp_token) { setNubraError(data.error ?? data.message ?? 'Failed to send OTP'); setNubraLogging(false); return; }
      setSetupTempToken(data.temp_token); setSetupStep('otp');
    } catch (e) { setNubraError(e instanceof Error ? e.message : 'Network error'); }
    setNubraLogging(false);
  }, [nubraPhone]);

  const handleNubraSetupTotp = useCallback(async () => {
    if (!setupOtp || !nubraMpin) { setNubraError('Enter OTP and MPIN'); return; }
    setNubraLogging(true); setNubraError('');
    try {
      const res = await fetch('/api/nubra-setup-totp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: nubraPhone, otp: setupOtp, mpin: nubraMpin, temp_token: setupTempToken }) });
      const data = await res.json();
      if (!res.ok || !data.secret_key) {
        setNubraError(`${data.error ?? 'Setup failed'}${data.step ? ` (step ${data.step})` : ''}${data.detail?.message ? ': ' + data.detail.message : ''}`);
        setNubraLogging(false); return;
      }
      localStorage.setItem('nubra_phone', nubraPhone); localStorage.setItem('nubra_mpin', nubraMpin);
      localStorage.setItem('nubra_totp_secret', data.secret_key); localStorage.setItem('nubra_session_token', data.session_token);
      localStorage.setItem('nubra_auth_token', data.auth_token);
      if (data.device_id) localStorage.setItem('nubra_device_id', data.device_id);
      localStorage.setItem('nubra_raw_cookie', `authToken=${data.auth_token}; sessionToken=${data.session_token}`);
      setNubraTotpSecret(data.secret_key); setNubraSession(data.session_token); setSetupStep('done'); setShowNubraPanel(false);
    } catch (e) { setNubraError(e instanceof Error ? e.message : 'Network error'); }
    setNubraLogging(false);
  }, [nubraPhone, nubraMpin, setupOtp, setupTempToken]);

  const handleNubraLogout = useCallback(() => {
    ['nubra_session_token', 'nubra_auth_token', 'nubra_raw_cookie'].forEach(k => localStorage.removeItem(k));
    setNubraSession('');
  }, []);

  const handleNubraReset = useCallback(() => {
    ['nubra_phone', 'nubra_mpin', 'nubra_totp_secret', 'nubra_session_token', 'nubra_auth_token', 'nubra_raw_cookie'].forEach(k => localStorage.removeItem(k));
    setNubraPhone(''); setNubraMpin(''); setNubraTotpSecret(''); setNubraSession('');
    setSetupStep('phone'); setSetupOtp(''); setSetupTempToken(''); setNubraError('');
  }, []);

  useEffect(() => { if (token) wsManager.connect(token); }, [token]);

  const handleTokenSave = useCallback(() => {
    const t = tokenInput.trim(); localStorage.setItem('upstox_token', t); setToken(t); setShowTokenInput(false); if (t) wsManager.connect(t);
  }, [tokenInput]);

  const handleAutoLogin = useCallback(() => {
    setAutoLoginLoading(true);
    setAutoLoginError('');
    // Connect directly to backend — bypasses Vite proxy which triggers HMR reload on SSE close
    const es = new EventSource('http://localhost:3001/api/upstox-login-stream');
    let done = false;

    es.addEventListener('token', (e) => {
      done = true;
      es.close();
      try {
        const { access_token } = JSON.parse(e.data);
        localStorage.setItem('upstox_token', access_token);
        setToken(access_token); setTokenInput(access_token); setShowTokenInput(false);
        wsManager.connect(access_token);
      } catch { setAutoLoginError('Invalid token response'); }
      setAutoLoginLoading(false);
    });

    es.addEventListener('error', (e: Event) => {
      done = true;
      es.close();
      try { const d = JSON.parse((e as MessageEvent).data ?? '{}'); setAutoLoginError(d.error ?? 'Login failed'); }
      catch { setAutoLoginError('Login failed'); }
      setAutoLoginLoading(false);
    });

    // onerror fires when SSE connection closes — only treat as error if we never got a token
    es.onerror = () => {
      if (done) return;
      es.close();
      setAutoLoginError('Connection lost');
      setAutoLoginLoading(false);
    };
  }, []);

  const workerRef = useRef<Worker | null>(null);
  const workerReady = useRef(false);
  // 'chart' = chart-modal search, 'mtm' = MTM analyzer search
  const workerModeRef = useRef<'header' | 'chart' | 'mtm'>('header');
  const mtmSearchResultsCallbackRef = useRef<((results: Instrument[]) => void) | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'READY') workerReady.current = true;
      if (e.data.type === 'RESULTS') {
        if (workerModeRef.current === 'chart') {
          setChartSearchResults(e.data.results);
        } else if (workerModeRef.current === 'mtm') {
          mtmSearchResultsCallbackRef.current?.(e.data.results);
        }
      }
    };
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    if (status.phase === 'ready' && instruments.length > 0 && workerRef.current) {
      workerRef.current.postMessage({ type: 'BUILD', instruments });
    }
  }, [status.phase, instruments]);

  const chartSearchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleChartSearchChange = useCallback((v: string) => {
    setChartSearchQuery(v);
    setChartSearchCursor(0);
    if (chartSearchDebounce.current) clearTimeout(chartSearchDebounce.current);
    if (!v.trim()) { setChartSearchResults([]); return; }
    chartSearchDebounce.current = setTimeout(() => {
      if (workerRef.current && workerReady.current) {
        workerModeRef.current = 'chart';
        workerRef.current.postMessage({ type: 'SEARCH', query: v });
      }
    }, 150);
  }, []);

  const openChartSearch = useCallback((seedChar?: string) => {
    setChartSearchQuery(seedChar ?? '');
    setChartSearchResults([]);
    setChartSearchTab('ALL');
    setShowChartSearch(true);
    if (seedChar && workerRef.current && workerReady.current) {
      workerModeRef.current = 'chart';
      workerRef.current.postMessage({ type: 'SEARCH', query: seedChar });
    }
    // Focus input after React has painted the modal
    requestAnimationFrame(() => {
      const el = chartSearchInputRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
  }, []);

  const closeChartSearch = useCallback(() => {
    setShowChartSearch(false);
    setChartSearchQuery('');
    setChartSearchResults([]);
    setChartSearchCursor(0);
  }, []);

  const chartTabResults = filterByTab(chartSearchResults, chartSearchTab);

  const handleChartSelectInstrument = useCallback((ins: Instrument) => {
    if (paneSearchCallbackRef.current) {
      paneSearchCallbackRef.current(ins);
      paneSearchCallbackRef.current = null;
    } else {
      navigateTo('chart');
    }
    closeChartSearch();
  }, [closeChartSearch, navigateTo]);

  // ── Global keydown → open chart search modal ───────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showChartSearch) {
        if (e.key === 'Escape') { closeChartSearch(); e.preventDefault(); }
        return;
      }
      if (page !== 'chart') return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') { openChartSearch(''); e.preventDefault(); return; }
      if (e.key.length === 1) { openChartSearch(e.key); e.preventDefault(); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [page, showChartSearch, openChartSearch, closeChartSearch]);

  // Auto-activate first pane on mount / when panes change and nothing is active
  useEffect(() => {
    if (!activePaneIdRef.current && workspaceState.panes.length > 0) {
      const id = workspaceState.panes[0].id;
      queueMicrotask(() => setActivePane(id));
    }
  }, [workspaceState.panes]);

  if (status.phase !== 'ready') return <LoadingScreen status={status} />;

  const NAV_ITEMS: { page: Page; label: string; icon: React.ReactNode }[] = [
    { page: 'chart', label: 'Charts', icon: <IconBarChart2 /> },
    { page: 'straddle', label: 'Straddle', icon: <IconLayers /> },
    { page: 'oiprofile', label: 'OI Profile', icon: <IconActivity /> },
    { page: 'nubra', label: 'Nubra IV', icon: <IconFlask /> },
    { page: 'backtest', label: 'Backtest', icon: <IconClock /> },
    { page: 'historical', label: 'Historical', icon: <IconHistory /> },
  ];

  return (
    <SidebarProvider defaultOpen={true}>
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <Sidebar>
        {/* Logo */}
        <SidebarHeader>
          <div className="flex items-center gap-2 px-1 py-1">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-[rgba(255,152,0,0.15)] border border-[rgba(255,152,0,0.3)]">
              <IconBolt />
            </div>
            <span className="text-[13px] font-bold tracking-[0.15em] text-[#FF9800] uppercase">URJAA</span>
          </div>
        </SidebarHeader>

        {/* Nav */}
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map(({ page: p, label, icon }) => (
                  <SidebarMenuItem key={p}>
                    <SidebarMenuButton
                      isActive={page === p}
                      onClick={() => navigateTo(p)}
                      className="cursor-pointer"
                    >
                      {icon}
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        {/* Footer — connection status */}
        <SidebarFooter>
          <div className="space-y-1.5">
            {/* Upstox WS */}
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <StatusDot status={isConnected ? 'ok' : 'off'} />
                <span className="text-[11px] font-medium text-[#787B86]">
                  {isConnected ? 'Upstox Live' : token ? <WsStatus key={token} token={token} /> : 'Upstox'}
                </span>
              </div>
              <Btn variant={isConnected ? 'green' : 'default'} onClick={() => setShowTokenInput(v => !v)} title="Set Upstox token">
                <IconBolt />
              </Btn>
            </div>

            {/* Token input panel */}
            {showTokenInput && (
              <div className="flex flex-col gap-1.5 pt-1">
                <TextInput value={tokenInput} onChange={setTokenInput} onEnter={handleTokenSave} onEscape={() => setShowTokenInput(false)} placeholder="Paste Upstox token…" autoFocus />
                <div className="flex gap-1">
                  <Btn variant="primary" onClick={handleTokenSave}>Connect</Btn>
                  <Btn variant="indigo" onClick={handleAutoLogin} loading={autoLoginLoading}>Auto</Btn>
                  <Btn variant="ghost" onClick={() => setShowTokenInput(false)}><IconClose /></Btn>
                </div>
                {autoLoginError && (
                  <span className="text-[11px] text-red-400 leading-tight">{autoLoginError}</span>
                )}
                {autoLoginLoading && (
                  <span className="text-[11px] text-[#787B86] animate-pulse">Launching browser login… (up to 90s)</span>
                )}
              </div>
            )}

            {/* Nubra */}
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <StatusDot status={nubraLoggedIn ? 'warn' : 'off'} />
                <span className="text-[11px] font-medium text-[#787B86]">
                  {nubraLoggedIn ? 'Nubra' : hasSecret ? 'Nubra' : 'Nubra'}
                </span>
              </div>
              <Btn variant={nubraLoggedIn ? 'amber' : 'default'} onClick={() => nubraLoggedIn ? handleNubraLogout() : setShowNubraPanel(v => !v)} title="Nubra login">
                <IconApi />
              </Btn>
            </div>

            {/* Nubra panel */}
            {showNubraPanel && (
              <div className="flex flex-col gap-1.5 pt-1">
                {!hasSecret ? (
                  setupStep === 'phone' ? (
                    <>
                      <TextInput value={nubraPhone} onChange={setNubraPhone} onEnter={handleNubraSendOtp} placeholder="Phone number" autoFocus />
                      <div className="flex gap-1">
                        <Btn variant="primary" loading={nubraLogging} onClick={handleNubraSendOtp}>Send OTP</Btn>
                        <Btn variant="ghost" onClick={() => { setShowNubraPanel(false); setNubraError(''); }}><IconClose /></Btn>
                      </div>
                    </>
                  ) : (
                    <>
                      <TextInput value={setupOtp} onChange={setSetupOtp} placeholder="OTP" autoFocus />
                      <TextInput value={nubraMpin} onChange={setNubraMpin} onEnter={handleNubraSetupTotp} placeholder="MPIN" type="password" />
                      <div className="flex gap-1">
                        <Btn variant="green" loading={nubraLogging} onClick={handleNubraSetupTotp}>Setup</Btn>
                        <Btn variant="ghost" onClick={() => { setShowNubraPanel(false); setNubraError(''); setSetupStep('phone'); setSetupOtp(''); }}><IconClose /></Btn>
                      </div>
                    </>
                  )
                ) : (
                  <>
                    <span className="text-[10px] text-[#787B86] px-1 truncate">{nubraPhone}</span>
                    <TextInput value={nubraMpin} onChange={setNubraMpin} onEnter={handleNubraLogin} placeholder="MPIN" type="password" autoFocus />
                    <div className="flex gap-1">
                      <Btn variant="primary" loading={nubraLogging} onClick={handleNubraLogin}>Login</Btn>
                      <Btn variant="ghost" onClick={handleNubraReset}>Reset</Btn>
                      <Btn variant="ghost" onClick={() => { setShowNubraPanel(false); setNubraError(''); }}><IconClose /></Btn>
                    </div>
                  </>
                )}
                {nubraError && <span className="text-[10px] text-[#f23645] px-1 truncate">{nubraError}</span>}
              </div>
            )}

            {/* Cookie */}
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <StatusDot status={nubraHasCookie ? 'indigo' : 'off'} />
                <span className="text-[11px] font-medium text-[#787B86]">{nubraHasCookie ? 'Cookie ✓' : 'Cookie'}</span>
              </div>
              <Btn variant={nubraHasCookie ? 'indigo' : 'default'} onClick={() => { setCookieInput(localStorage.getItem('nubra_raw_cookie') ?? ''); setShowCookieInput(v => !v); }} title="Set Nubra cookie">
                <IconCookie />
              </Btn>
            </div>

            {showCookieInput && (
              <div className="flex flex-col gap-1.5 pt-1">
                <TextAreaInput value={cookieInput} onChange={setCookieInput} placeholder="Paste Nubra cookie…" autoFocus />
                <div className="flex gap-1">
                  <Btn variant="indigo" onClick={() => { localStorage.setItem('nubra_raw_cookie', cookieInput.trim()); setShowCookieInput(false); }}>Save</Btn>
                  <Btn variant="ghost" onClick={() => setShowCookieInput(false)}><IconClose /></Btn>
                </div>
              </div>
            )}

            {/* Instrument count */}
            <div className="px-1 pt-1 text-[10px] text-[#787B86]">
              {status.total.toLocaleString()} instruments cached
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>

      {/* ── Main area ───────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col min-w-0 h-screen">
        {/* Top bar */}
        <header className="glass-navbar flex h-12 shrink-0 items-center gap-3 px-4" style={{ minHeight: 48 }}>
          <SidebarTrigger />
          <div className="h-5 w-px bg-[#2a2a2a]" />

          {/* Page title when not on chart */}
          {page !== 'chart' && page !== 'mtm' && (
            <span className="text-[13px] font-semibold text-[#D1D4DC]">
              {NAV_ITEMS.find(n => n.page === page)?.label}
            </span>
          )}

          {/* Navbar links */}
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => navigateTo('mtm')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                height: 32, padding: '0 14px',
                borderRadius: 7,
                fontSize: 13, fontWeight: 700, letterSpacing: '0.01em',
                cursor: 'pointer',
                border: page === 'mtm' ? '1px solid rgba(79,142,247,0.45)' : '1px solid transparent',
                background: page === 'mtm' ? 'rgba(79,142,247,0.18)' : 'transparent',
                color: page === 'mtm' ? '#FFFFFF' : '#D1D4DC',
                boxShadow: page === 'mtm' ? '0 0 12px rgba(79,142,247,0.25)' : 'none',
                transition: 'background 0.15s, color 0.15s, border-color 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={e => { if (page !== 'mtm') { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)'; (e.currentTarget as HTMLElement).style.color = '#FFFFFF'; } }}
              onMouseLeave={e => { if (page !== 'mtm') { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#D1D4DC'; } }}
            >
              <span style={{ lineHeight: 0, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 6, background: page === 'mtm' ? 'rgba(79,142,247,0.25)' : 'rgba(255,255,255,0.08)', border: page === 'mtm' ? '1px solid rgba(79,142,247,0.55)' : '1px solid rgba(255,255,255,0.12)', color: page === 'mtm' ? '#7EB8FF' : '#C9D1DC', transition: 'background 0.15s, border-color 0.15s, color 0.15s' }}><IconTrendingUp /></span>
              <span style={{ lineHeight: 1 }}>Mtm Analyzer</span>
            </button>
          </div>

        </header>

        {/* Page content
            Strategy: lazy-mount + keep-alive.
            - A page mounts only on first visit (no upfront cost).
            - After first visit it is never unmounted — state, WS subs, and
              chart instances all survive tab switches.
            - We use visibility:hidden / pointer-events:none (not display:none)
              so Ant Design / glide-data-grid can still measure the DOM and
              never trigger the "Maximum update depth exceeded" setState loop.
            - Heavy pages (OI Profile, Backtest) stay on-demand: mount on
              visit, unmount on leave, to avoid 300+ idle WS subscriptions.
        */}
        <main className="flex-1 overflow-hidden relative" style={{ background: '#171717' }}>
          {/* Keep-alive pattern: every page is absolute inset-0.
              - display:none  → safe for pages with no Ant Design (Chart, Straddle)
              - visibility:hidden → for pages with Ant Design (Nubra, Historical)
                so their components can still measure DOM without infinite setState loops.
              - Lazy-mount: only added to DOM on first visit. */}

          {/* Chart — multi-pane workspace */}
          {(page === 'chart' || visited.has('chart')) && (
            <div className="absolute inset-0" style={{ display: page === 'chart' ? 'flex' : 'none' }}>
              <WorkspaceRoot
                state={workspaceState}
                dispatch={workspaceDispatch}
                instruments={instruments}
                activePaneId={activePaneId}
                onPaneClick={setActivePane}
                onPaneSearch={(paneId, onSelect) => {
                  setActivePane(paneId);
                  paneSearchCallbackRef.current = onSelect;
                  openChartSearch('');
                }}
              />
            </div>
          )}

          {/* Straddle — display:none safe (no Ant Design) */}
          {(page === 'straddle' || visited.has('straddle')) && (
            <div className="absolute inset-0" style={{ display: page === 'straddle' ? 'block' : 'none' }}>
              <StraddleChart instruments={instruments} visible={page === 'straddle'} />
            </div>
          )}

          {/* Nubra IV — visibility:hidden (uses Ant Design, needs DOM measurement) */}
          {(page === 'nubra' || visited.has('nubra')) && (
            <div className="absolute inset-0" style={{ visibility: page === 'nubra' ? 'visible' : 'hidden', pointerEvents: page === 'nubra' ? 'auto' : 'none', zIndex: page === 'nubra' ? 1 : 0 }}>
              <NubraApiTester />
            </div>
          )}

          {/* Historical — visibility:hidden (uses Ant Design) */}
          {(page === 'historical' || visited.has('historical')) && (
            <div className="absolute inset-0" style={{ visibility: page === 'historical' ? 'visible' : 'hidden', pointerEvents: page === 'historical' ? 'auto' : 'none', zIndex: page === 'historical' ? 1 : 0 }}>
              <HistoricalWorkspace />
            </div>
          )}

          {/* OI Profile — keep-alive with visibility */}
          {(page === 'oiprofile' || visited.has('oiprofile')) && (
            <div className="absolute inset-0" style={{ visibility: page === 'oiprofile' ? 'visible' : 'hidden', pointerEvents: page === 'oiprofile' ? 'auto' : 'none', zIndex: page === 'oiprofile' ? 1 : 0 }}>
              <OIProfileView instruments={instruments} />
            </div>
          )}

          {/* Backtest — keep-alive with visibility */}
          {(page === 'backtest' || visited.has('backtest')) && (
            <div className="absolute inset-0" style={{ visibility: page === 'backtest' ? 'visible' : 'hidden', pointerEvents: page === 'backtest' ? 'auto' : 'none', zIndex: page === 'backtest' ? 1 : 0 }}>
              <Backtest />
            </div>
          )}

          {/* MTM Analyzer */}
          {(page === 'mtm' || visited.has('mtm')) && (
            <MtmLayout visible={page === 'mtm'} workerRef={workerRef} workerReady={workerReady} workerModeRef={workerModeRef} mtmResultsCbRef={mtmSearchResultsCallbackRef} instruments={instruments} />
          )}

        </main>
      </div>

      {/* ── Chart Symbol Search Modal ─────────────────────────────── */}
      {showChartSearch && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[8vh]"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', animation: 'fadeIn 0.12s ease' }}
          onMouseDown={e => { if (e.target === e.currentTarget) closeChartSearch(); }}
        >
          <div style={{
            width: 660, maxHeight: '78vh', display: 'flex', flexDirection: 'column',
            borderRadius: 14,
            background: 'rgba(15,18,27,0.98)',
            border: '1px solid rgba(255,255,255,0.09)',
            boxShadow: '0 40px 100px rgba(0,0,0,0.85), 0 1px 0 rgba(255,255,255,0.06) inset',
            overflow: 'hidden',
            animation: 'slideUp 0.14s cubic-bezier(0.16,1,0.3,1)',
          }}>
            {/* Search input — full-width, no title bar */}
            <div style={{ padding: '14px 16px 0' }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span style={{ position: 'absolute', left: 14, color: '#4A4E5C', pointerEvents: 'none', display: 'flex', transition: 'color 0.15s' }}><IconSearch /></span>
                <input
                  ref={chartSearchInputRef}
                  value={chartSearchQuery}
                  onChange={e => handleChartSearchChange(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') { closeChartSearch(); return; }
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      const next = Math.min(chartSearchCursor + 1, chartTabResults.length - 1);
                      setChartSearchCursor(next);
                      chartSearchListRef.current?.children[next]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      const prev = Math.max(chartSearchCursor - 1, 0);
                      setChartSearchCursor(prev);
                      chartSearchListRef.current?.children[prev]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                    } else if (e.key === 'Enter' && chartTabResults.length > 0) {
                      handleChartSelectInstrument(chartTabResults[chartSearchCursor]);
                    }
                  }}
                  placeholder="Search symbol…"
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '11px 40px 11px 42px',
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
                    borderRadius: 10, outline: 'none', fontSize: 15, fontWeight: 500,
                    color: '#E8EAF0', letterSpacing: '-0.01em', caretColor: '#4F8EF7',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'rgba(79,142,247,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(79,142,247,0.10)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)'; e.currentTarget.style.boxShadow = 'none'; }}
                />
                {chartSearchQuery && (
                  <button onClick={() => { setChartSearchQuery(''); setChartSearchResults([]); setChartSearchCursor(0); }} style={{ position: 'absolute', right: 12, background: 'rgba(255,255,255,0.07)', border: 'none', cursor: 'pointer', color: '#787B86', display: 'flex', padding: 3, borderRadius: 4 }}><IconClose /></button>
                )}
              </div>
            </div>

            {/* Tab pills */}
            <div style={{ display: 'flex', gap: 4, padding: '10px 16px 10px', flexWrap: 'wrap' }}>
              {TABS.map(t => (
                <button key={t} onClick={() => { setChartSearchTab(t); setChartSearchCursor(0); }} style={{
                  padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  border: '1px solid', cursor: 'pointer', transition: 'all 0.12s', lineHeight: 1.5,
                  background: chartSearchTab === t ? 'rgba(79,142,247,0.15)' : 'transparent',
                  borderColor: chartSearchTab === t ? 'rgba(79,142,247,0.4)' : 'rgba(255,255,255,0.08)',
                  color: chartSearchTab === t ? '#4F8EF7' : '#565A6B',
                }}>
                  {t}
                </button>
              ))}
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', flexShrink: 0 }} />

            {/* Results */}
            <div ref={chartSearchListRef} style={{ overflowY: 'auto', flex: 1, scrollbarWidth: 'thin', scrollbarColor: '#2a2a2a transparent' }}>
              {!chartSearchQuery.trim() ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: 12, color: '#2E3240', letterSpacing: '0.06em' }}>
                  Search across {status.total.toLocaleString()} instruments
                </div>
              ) : chartTabResults.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: 12, color: '#3D4150' }}>No results for "{chartSearchQuery}"</div>
              ) : chartTabResults.map((ins, i) => (
                <div key={ins.instrument_key}
                  onClick={() => handleChartSelectInstrument(ins)}
                  onMouseEnter={() => setChartSearchCursor(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '11px 18px', cursor: 'pointer',
                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                    background: i === chartSearchCursor ? 'rgba(79,142,247,0.10)' : 'transparent',
                    transition: 'background 0.08s',
                    willChange: 'background',
                  }}
                >
                  {/* Exchange logo / badge */}
                  <div style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {ins.exchange === 'NSE' ? (
                      <img src="https://s3-symbol-logo.tradingview.com/source/NSE.svg" alt="NSE" style={{ width: 24, height: 24, objectFit: 'contain', opacity: 0.85 }} />
                    ) : ins.exchange === 'BSE' ? (
                      <img src="https://s3-symbol-logo.tradingview.com/source/BSE.svg" alt="BSE" style={{ width: 24, height: 24, objectFit: 'contain', opacity: 0.85 }} />
                    ) : ins.exchange === 'MCX' ? (
                      <img src="https://s3-symbol-logo.tradingview.com/source/MCX.svg" alt="MCX" style={{ width: 24, height: 24, objectFit: 'contain', opacity: 0.85 }} />
                    ) : (
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#9598A1', letterSpacing: '0.04em' }}>{ins.exchange}</span>
                    )}
                  </div>

                  {/* Symbol + name */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#E0E3EB', letterSpacing: '0.01em' }}>
                      <Highlight text={ins.trading_symbol} query={chartSearchQuery} />
                    </div>
                    <div style={{ fontSize: 12, color: '#565A6B', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <Highlight text={ins.name} query={chartSearchQuery} />
                    </div>
                  </div>

                  {/* Type pill */}
                  <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: 'rgba(255,255,255,0.05)', color: '#565A6B', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', flexShrink: 0 }}>
                    {ins.instrument_type}
                  </span>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}>
              <span style={{ fontSize: 11, color: '#4A4E5C' }}><kbd style={{ fontFamily: 'monospace' }}>↵</kbd> select</span>
              <span style={{ fontSize: 11, color: '#4A4E5C' }}><kbd style={{ fontFamily: 'monospace' }}>Esc</kbd> close</span>
            </div>
          </div>
        </div>
      )}
    </SidebarProvider>
  );

}
