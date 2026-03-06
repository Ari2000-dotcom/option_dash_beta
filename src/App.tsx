import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useInstruments, type Instrument } from './useInstruments';
import LoadingScreen from './LoadingScreen';
import CandleChart from './CandleChart';
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
import './index.css';

type Page = 'chart' | 'straddle' | 'oiprofile' | 'nubra' | 'backtest' | 'historical';
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
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>;
}
function IconClose() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>;
}
function IconBolt() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>;
}
function IconApi() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>;
}
function IconCookie() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/><circle cx="9" cy="15" r="1" fill="currentColor"/></svg>;
}

// ── Page nav items ────────────────────────────────────────────────────────────
// Charts — candlestick bars
function IconBarChart2() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  );
}
// Straddle — stacked layers (options spread)
function IconLayers() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2"/>
      <polyline points="2 17 12 22 22 17"/>
      <polyline points="2 12 12 17 22 12"/>
    </svg>
  );
}
// OI Profile — pulse/waveform (open interest activity)
function IconActivity() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  );
}
// Nubra IV — beaker/flask (implied volatility lab)
function IconFlask() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6"/>
      <path d="M10 3v7l-4 8a1 1 0 0 0 .9 1.45h10.2a1 1 0 0 0 .9-1.45L14 10V3"/>
    </svg>
  );
}
// Backtest — play button inside circle (run simulation)
function IconClock() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/>
    </svg>
  );
}
// Historical — calendar with clock (historical data)
function IconHistory() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
      <polyline points="9 16 12 14 12 18"/>
    </svg>
  );
}

function StatusDot({ status }: { status: 'ok' | 'warn' | 'indigo' | 'off' }) {
  const colors = {
    ok:     'bg-[#2ebd85] shadow-[0_0_5px_#2ebd85]',
    warn:   'bg-[#FF9800] shadow-[0_0_5px_#FF9800]',
    indigo: 'bg-[#818cf8] shadow-[0_0_5px_#818cf8] animate-pulse',
    off:    'bg-[#363A45]',
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
    default: 'bg-transparent border-[#2A2E39] text-[#787B86] hover:border-[#363A45] hover:text-[#D1D4DC]',
    primary: 'bg-[rgba(255,152,0,0.85)] border-[rgba(255,152,0,0.5)] text-white hover:bg-[rgba(255,152,0,1)]',
    ghost:   'bg-transparent border-transparent text-zinc-500 hover:text-zinc-400',
    green:   'bg-[rgba(46,189,133,0.08)] border-[rgba(46,189,133,0.4)] text-[#2ebd85] hover:bg-[rgba(46,189,133,0.15)]',
    indigo:  'bg-[rgba(129,140,248,0.08)] border-[rgba(129,140,248,0.35)] text-[#818cf8] hover:bg-[rgba(129,140,248,0.15)]',
    amber:   'bg-[rgba(255,152,0,0.10)] border-[rgba(255,152,0,0.45)] text-[#FF9800] hover:bg-[rgba(255,152,0,0.15)]',
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
      className="h-6 px-2 text-[11px] bg-[#1E222D] border border-[#2A2E39] text-[#D1D4DC] placeholder-[#4A4E5C] outline-none focus:border-[rgba(255,152,0,0.45)] transition-colors"
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
      className="px-2 py-1 text-[10px] bg-[#1E222D] border border-[#2A2E39] text-[#D1D4DC] placeholder-[#4A4E5C] outline-none focus:border-[rgba(255,152,0,0.45)] transition-colors"
    />
  );
}

// Shows "Connecting…" for up to 8s, then "Token invalid" if still not connected
function WsStatus({ token }: { token: string }) {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    setTimedOut(false);
    const t = setTimeout(() => setTimedOut(true), 20000);
    return () => clearTimeout(t);
  }, [token]);
  return <>{timedOut ? <span className="text-red-400">Token expired — click Auto</span> : 'Connecting…'}</>;
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const { instruments, status } = useInstruments();
  const [page, setPage] = useState<Page>('chart');
  // Tracks which pages have been visited — lazy-mount keep-alive pattern.
  // Once a page is visited it is never unmounted (state + WS survive tab switches).
  const visitedRef = useRef<Set<Page>>(new Set<Page>(['chart']));
  const navigateTo = useCallback((p: Page) => { visitedRef.current.add(p); setPage(p); }, []);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Instrument[]>([]);
  const [tab, setTab] = useState<Tab>('ALL');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument | null>(null);

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
    } catch (e: any) { setNubraError(e.message ?? 'Network error'); }
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
    } catch (e: any) { setNubraError(e.message ?? 'Network error'); }
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
    } catch (e: any) { setNubraError(e.message ?? 'Network error'); }
    setNubraLogging(false);
  }, [nubraPhone, nubraMpin, setupOtp, setupTempToken]);

  const handleNubraLogout = useCallback(() => {
    ['nubra_session_token', 'nubra_auth_token', 'nubra_raw_cookie'].forEach(k => localStorage.removeItem(k));
    setNubraSession('');
  }, []);

  const handleNubraReset = useCallback(() => {
    ['nubra_phone','nubra_mpin','nubra_totp_secret','nubra_session_token','nubra_auth_token','nubra_raw_cookie'].forEach(k => localStorage.removeItem(k));
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

    es.addEventListener('error', (e: any) => {
      done = true;
      es.close();
      try { const d = JSON.parse(e.data ?? '{}'); setAutoLoginError(d.error ?? 'Login failed'); }
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chartDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workerReady = useRef(false);
  // 'header' = top-bar search, 'chart' = chart-modal search
  const workerModeRef = useRef<'header' | 'chart'>('header');
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchDropdownPos = useRef<{ top: number; left: number; width: number } | null>(null);
  const smoothDeleteRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'READY') workerReady.current = true;
      if (e.data.type === 'RESULTS') {
        if (workerModeRef.current === 'chart') {
          setChartSearchResults(e.data.results);
        } else {
          setResults(e.data.results);
          setShowDropdown(true);
        }
      }
    };
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    if (status.phase === 'ready' && instruments.length > 0 && workerRef.current) {
      workerRef.current.postMessage({ type: 'LOAD', payload: instruments });
    }
  }, [status.phase, instruments]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!inputRef.current?.contains(e.target as Node) && !dropdownRef.current?.contains(e.target as Node)) {
        setShowDropdown(false);
        searchDropdownPos.current = null;
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleChange = useCallback((v: string) => {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!v.trim()) { setResults([]); setShowDropdown(false); return; }
    // Snapshot position once when dropdown is about to open
    if (inputRef.current && !searchDropdownPos.current) {
      const r = inputRef.current.getBoundingClientRect();
      searchDropdownPos.current = { top: r.bottom + 2, left: r.left, width: Math.max(r.width, 540) };
    }
    debounceRef.current = setTimeout(() => {
      if (workerRef.current && workerReady.current) {
        workerModeRef.current = 'header';
        workerRef.current.postMessage({ type: 'SEARCH', payload: v });
      }
    }, 80);
  }, []);

  const handleChartSearchChange = useCallback((v: string) => {
    setChartSearchQuery(v);
    if (chartDebounceRef.current) clearTimeout(chartDebounceRef.current);
    if (!v.trim()) { setChartSearchResults([]); return; }
    chartDebounceRef.current = setTimeout(() => {
      if (workerRef.current && workerReady.current) {
        workerModeRef.current = 'chart';
        workerRef.current.postMessage({ type: 'SEARCH', payload: v });
      }
    }, 80);
  }, []);

  const openChartSearch = useCallback((seedChar?: string) => {
    setChartSearchQuery(seedChar ?? '');
    setChartSearchResults([]);
    setChartSearchTab('ALL');
    setShowChartSearch(true);
    if (seedChar && workerRef.current && workerReady.current) {
      workerModeRef.current = 'chart';
      workerRef.current.postMessage({ type: 'SEARCH', payload: seedChar });
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
  }, []);

  const tabResults = filterByTab(results, tab);
  const chartTabResults = filterByTab(chartSearchResults, chartSearchTab);

  const handleSelectInstrument = useCallback((ins: Instrument) => {
    if (page === 'chart' && activePaneIdRef.current) {
      // Route to active pane
      workspaceDispatch({ type: 'SET_INSTRUMENT', paneId: activePaneIdRef.current, instrument: ins });
      // Also ensure the pane is in candle view
      workspaceDispatch({ type: 'SET_VIEW', paneId: activePaneIdRef.current, viewType: 'candle' });
      setShowDropdown(false); setQuery(''); setResults([]);
    } else {
      setSelectedInstrument(ins); setShowDropdown(false); setQuery(ins.trading_symbol); setResults([]);
    }
  }, [page, workspaceDispatch]);

  const handleChartSelectInstrument = useCallback((ins: Instrument) => {
    if (paneSearchCallbackRef.current) {
      paneSearchCallbackRef.current(ins);
      paneSearchCallbackRef.current = null;
    } else {
      setSelectedInstrument(ins);
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
      setActivePane(workspaceState.panes[0].id);
    }
  }, [workspaceState.panes]);

  if (status.phase !== 'ready') return <LoadingScreen status={status} />;

  const NAV_ITEMS: { page: Page; label: string; icon: React.ReactNode }[] = [
    { page: 'chart',      label: 'Charts',      icon: <IconBarChart2 /> },
    { page: 'straddle',   label: 'Straddle',    icon: <IconLayers /> },
    { page: 'oiprofile',  label: 'OI Profile',  icon: <IconActivity /> },
    { page: 'nubra',      label: 'Nubra IV',    icon: <IconFlask /> },
    { page: 'backtest',   label: 'Backtest',    icon: <IconClock /> },
    { page: 'historical', label: 'Historical',  icon: <IconHistory /> },
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
        <header className="glass-navbar flex h-10 shrink-0 items-center gap-2 px-3">
          <SidebarTrigger />
          <div className="h-4 w-px bg-[#2A2E39]" />

          {/* Search — only on chart page */}
          {page === 'chart' && (
            <div className="flex-1 max-w-sm">
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span style={{ position: 'absolute', left: 10, color: '#787B86', pointerEvents: 'none', display: 'flex' }}><IconSearch /></span>
                {!query && workspaceState.panes.find(p => p.id === activePaneId)?.instrument?.trading_symbol && (
                  <span style={{
                    position: 'absolute', left: 34, pointerEvents: 'none',
                    fontSize: 12, fontWeight: 700, color: '#FF9800',
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                  }}>{workspaceState.panes.find(p => p.id === activePaneId)?.instrument?.trading_symbol}</span>
                )}
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => handleChange(e.target.value)}
                  onFocus={() => {
                    // Auto-set first pane as active if none selected
                    if (!activePaneIdRef.current && workspaceState.panes.length > 0) {
                      setActivePane(workspaceState.panes[0].id);
                    }
                    if (results.length > 0) setShowDropdown(true);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Backspace' || e.key === 'Delete') {
                      if (smoothDeleteRef.current) return;
                      smoothDeleteRef.current = setInterval(() => {
                        setQuery(q => {
                          if (!q) { if (smoothDeleteRef.current) { clearInterval(smoothDeleteRef.current); smoothDeleteRef.current = null; } return q; }
                          const next = q.slice(0, -1);
                          handleChange(next);
                          return next;
                        });
                      }, 40);
                    }
                  }}
                  onKeyUp={e => {
                    if (e.key === 'Backspace' || e.key === 'Delete') {
                      if (smoothDeleteRef.current) { clearInterval(smoothDeleteRef.current); smoothDeleteRef.current = null; }
                    }
                  }}
                  placeholder="Search symbol…"
                  autoFocus
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '7px 36px 7px 32px',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)',
                    borderRadius: 8, outline: 'none', fontSize: 13, color: '#D1D4DC',
                  }}
                />
                {query && (
                  <button style={{ position: 'absolute', right: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#787B86', display: 'flex', padding: 2 }}
                    onClick={() => { setQuery(''); setResults([]); setShowDropdown(false); searchDropdownPos.current = null; }}>
                    <IconClose />
                  </button>
                )}
              </div>

              {/* Search dropdown — portalled to body, TradingView style */}
              {showDropdown && query.trim() && searchDropdownPos.current && createPortal(
                <div ref={dropdownRef} style={{
                  position: 'fixed',
                  top: searchDropdownPos.current.top,
                  left: searchDropdownPos.current.left,
                  width: 560,
                  zIndex: 9999,
                  borderRadius: 12,
                  background: 'rgba(19, 23, 34, 0.97)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  boxShadow: '0 32px 80px rgba(0,0,0,0.75), 0 1px 0 rgba(255,255,255,0.07) inset',
                  overflow: 'hidden',
                  display: 'flex', flexDirection: 'column',
                }}>
                  {/* Title row */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 8px' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#D1D4DC' }}>Symbol Search</span>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#787B86', display: 'flex', padding: 2 }} onClick={() => setShowDropdown(false)}><IconClose /></button>
                  </div>
                  {/* Tab pills */}
                  <div style={{ display: 'flex', gap: 6, padding: '0 16px 10px', flexWrap: 'wrap' }}>
                    {TABS.map(t => (
                      <button key={t} onClick={() => setTab(t)} style={{
                        padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                        border: '1px solid', cursor: 'pointer', transition: 'all 0.15s', lineHeight: 1.4,
                        background: tab === t ? 'rgba(255,255,255,0.12)' : 'transparent',
                        borderColor: tab === t ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.10)',
                        color: tab === t ? '#D1D4DC' : '#787B86',
                      }}>
                        {t}
                      </button>
                    ))}
                  </div>
                  {/* Divider */}
                  <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />
                  {/* Results */}
                  <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
                    {tabResults.length === 0 ? (
                      <div style={{ padding: '28px 16px', textAlign: 'center', fontSize: 12, color: '#787B86' }}>No results</div>
                    ) : tabResults.map((ins, i) => (
                      <div key={ins.instrument_key} onClick={() => handleSelectInstrument(ins)}
                        className="search-result-row"
                        style={{
                          display: 'grid', gridTemplateColumns: '1fr 1fr auto',
                          padding: '8px 16px', cursor: 'pointer',
                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                          background: i === 0 ? 'rgba(255,255,255,0.04)' : undefined,
                        }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#D1D4DC' }}><Highlight text={ins.trading_symbol} query={query} /></div>
                        <div style={{ fontSize: 12, color: '#787B86', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}><Highlight text={ins.name} query={query} /></div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                          <span style={{ fontSize: 11, color: '#4A4E5C' }}>{ins.instrument_type?.toLowerCase()}</span>
                          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.07)', color: '#9598A1', fontWeight: 600 }}>{ins.exchange}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Footer */}
                  <div style={{ display: 'flex', gap: 16, padding: '7px 16px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}>
                    <span style={{ fontSize: 11, color: '#4A4E5C' }}><kbd style={{ fontFamily: 'monospace' }}>↵</kbd> select</span>
                    <span style={{ fontSize: 11, color: '#4A4E5C' }}><kbd style={{ fontFamily: 'monospace' }}>Esc</kbd> close</span>
                  </div>
                </div>,
                document.body
              )}
            </div>
          )}

          {/* Page title when not on chart */}
          {page !== 'chart' && (
            <span className="text-[12px] font-semibold text-[#D1D4DC]">
              {NAV_ITEMS.find(n => n.page === page)?.label}
            </span>
          )}

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
        <main className="flex-1 overflow-hidden relative" style={{ background: '#0d1117' }}>
          {/* Keep-alive pattern: every page is absolute inset-0.
              - display:none  → safe for pages with no Ant Design (Chart, Straddle)
              - visibility:hidden → for pages with Ant Design (Nubra, Historical)
                so their components can still measure DOM without infinite setState loops.
              - Lazy-mount: only added to DOM on first visit. */}

          {/* Chart — multi-pane workspace */}
          {(page === 'chart' || visitedRef.current.has('chart')) && (
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
          {(page === 'straddle' || visitedRef.current.has('straddle')) && (
            <div className="absolute inset-0" style={{ display: page === 'straddle' ? 'block' : 'none' }}>
              <StraddleChart instruments={instruments} visible={page === 'straddle'} />
            </div>
          )}

          {/* Nubra IV — visibility:hidden (uses Ant Design, needs DOM measurement) */}
          {(page === 'nubra' || visitedRef.current.has('nubra')) && (
            <div className="absolute inset-0" style={{ visibility: page === 'nubra' ? 'visible' : 'hidden', pointerEvents: page === 'nubra' ? 'auto' : 'none', zIndex: page === 'nubra' ? 1 : 0 }}>
              <NubraApiTester />
            </div>
          )}

          {/* Historical — visibility:hidden (uses Ant Design) */}
          {(page === 'historical' || visitedRef.current.has('historical')) && (
            <div className="absolute inset-0" style={{ visibility: page === 'historical' ? 'visible' : 'hidden', pointerEvents: page === 'historical' ? 'auto' : 'none', zIndex: page === 'historical' ? 1 : 0 }}>
              <HistoricalWorkspace />
            </div>
          )}

          {/* OI Profile — keep-alive with visibility */}
          {(page === 'oiprofile' || visitedRef.current.has('oiprofile')) && (
            <div className="absolute inset-0" style={{ visibility: page === 'oiprofile' ? 'visible' : 'hidden', pointerEvents: page === 'oiprofile' ? 'auto' : 'none', zIndex: page === 'oiprofile' ? 1 : 0 }}>
              <OIProfileView instruments={instruments} />
            </div>
          )}

          {/* Backtest — keep-alive with visibility */}
          {(page === 'backtest' || visitedRef.current.has('backtest')) && (
            <div className="absolute inset-0" style={{ visibility: page === 'backtest' ? 'visible' : 'hidden', pointerEvents: page === 'backtest' ? 'auto' : 'none', zIndex: page === 'backtest' ? 1 : 0 }}>
              <Backtest />
            </div>
          )}

        </main>
      </div>

      {/* ── Chart Symbol Search Modal ─────────────────────────────── */}
      {showChartSearch && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh]"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)' }}
          onMouseDown={e => { if (e.target === e.currentTarget) closeChartSearch(); }}
        >
          <div style={{
            width: 620, maxHeight: '76vh', display: 'flex', flexDirection: 'column',
            borderRadius: 12,
            background: 'rgba(19, 23, 34, 0.96)',
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: '0 32px 80px rgba(0,0,0,0.75), 0 1px 0 rgba(255,255,255,0.07) inset',
            overflow: 'hidden',
          }}>
            {/* Header: title + close */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 10px' }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#D1D4DC', letterSpacing: '-0.01em' }}>Symbol Search</span>
              <button onClick={closeChartSearch} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#787B86', padding: 4, display: 'flex', borderRadius: 6 }}><IconClose /></button>
            </div>

            {/* Search input */}
            <div style={{ padding: '0 16px 12px' }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span style={{ position: 'absolute', left: 12, color: '#787B86', pointerEvents: 'none', display: 'flex' }}><IconSearch /></span>
                <input
                  ref={chartSearchInputRef}
                  value={chartSearchQuery}
                  onChange={e => handleChartSearchChange(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') closeChartSearch(); if (e.key === 'Enter' && chartTabResults.length > 0) handleChartSelectInstrument(chartTabResults[0]); }}
                  placeholder="Search…"
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '9px 36px 9px 38px',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)',
                    borderRadius: 8, outline: 'none', fontSize: 14, fontWeight: 500,
                    color: '#D1D4DC', letterSpacing: '-0.01em',
                  }}
                />
                {chartSearchQuery && (
                  <button onClick={() => { setChartSearchQuery(''); setChartSearchResults([]); }} style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', color: '#787B86', display: 'flex', padding: 2 }}><IconClose /></button>
                )}
              </div>
            </div>

            {/* Tab pills — TradingView style */}
            <div style={{ display: 'flex', gap: 6, padding: '0 16px 12px', flexWrap: 'wrap' }}>
              {TABS.map(t => (
                <button key={t} onClick={() => setChartSearchTab(t)} style={{
                  padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                  border: '1px solid', cursor: 'pointer', transition: 'all 0.15s', lineHeight: 1.4,
                  background: chartSearchTab === t ? 'rgba(255,255,255,0.12)' : 'transparent',
                  borderColor: chartSearchTab === t ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.10)',
                  color: chartSearchTab === t ? '#D1D4DC' : '#787B86',
                }}>
                  {t}
                </button>
              ))}
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />

            {/* Results */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {!chartSearchQuery.trim() ? (
                <div style={{ padding: '32px 20px', textAlign: 'center', fontSize: 12, color: '#4A4E5C', letterSpacing: '0.05em' }}>
                  Start typing to search {status.total.toLocaleString()} instruments
                </div>
              ) : chartTabResults.length === 0 ? (
                <div style={{ padding: '32px 20px', textAlign: 'center', fontSize: 12, color: '#787B86' }}>No results for "{chartSearchQuery}"</div>
              ) : chartTabResults.map((ins, i) => (
                <div key={ins.instrument_key}
                  onClick={() => handleChartSelectInstrument(ins)}
                  className="chart-search-row"
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr auto',
                    padding: '9px 20px', cursor: 'pointer',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    background: i === 0 ? 'rgba(255,255,255,0.04)' : undefined,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#D1D4DC' }}>
                    <Highlight text={ins.trading_symbol} query={chartSearchQuery} />
                  </div>
                  <div style={{ fontSize: 12, color: '#787B86', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>
                    <Highlight text={ins.name} query={chartSearchQuery} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: 11, color: '#4A4E5C' }}>{ins.instrument_type?.toLowerCase()}</span>
                    <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.07)', color: '#9598A1', fontWeight: 600 }}>{ins.exchange}</span>
                  </div>
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
