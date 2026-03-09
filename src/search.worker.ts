import type { Instrument } from './useInstruments';

// ─────────────────────────────────────────────────────────────────────────────
// Prefix Trie + fast fallback search worker
//
// Protocol:
//   Main → Worker:  { type:'BUILD', instruments }   (once, on startup)
//   Main → Worker:  { type:'SEARCH', query }        (per keystroke, debounced)
//   Worker → Main:  { type:'READY', total }
//   Worker → Main:  { type:'RESULTS', results }
// ─────────────────────────────────────────────────────────────────────────────

// ── Worker state ─────────────────────────────────────────────────────────────
let instruments: Instrument[] = [];
// Pre-lowered search strings for fast filtering (avoids re-lowering on every query)
let searchIndex: { name: string; tsym: string; usym: string }[] = [];
let ready = false;

// ── Build index ──────────────────────────────────────────────────────────────
function buildIndex(data: Instrument[]) {
  instruments = data;
  searchIndex = new Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    searchIndex[i] = {
      name: (d.name ?? '').toLowerCase(),
      tsym: (d.trading_symbol ?? '').toLowerCase(),
      usym: (d.underlying_symbol ?? '').toLowerCase(),
    };
  }
  ready = true;
}

// ── Scoring ──────────────────────────────────────────────────────────────────
const now = Date.now();

function matchScore(si: { name: string; tsym: string; usym: string }, q: string): number {
  if (si.name === q || si.usym === q || si.tsym === q) return 0;         // exact
  if (si.name.startsWith(q) || si.usym.startsWith(q) || si.tsym.startsWith(q)) return 1; // prefix
  return 2; // substring
}

function typeRank(i: Instrument): number {
  const seg = i.segment?.toUpperCase() ?? '';
  const type = i.instrument_type?.toUpperCase() ?? '';
  // Order: INDEX → EQ → FUT → Options (CE/PE)
  if (seg.includes('INDEX') || type === 'INDEX') return 0;
  if (type === 'EQ') return 1;
  if (type === 'FUT') return 2;
  if (type === 'CE' || type === 'PE') return 3;
  return 4;
}

// ── Search ───────────────────────────────────────────────────────────────────
function search(query: string): Instrument[] {
  if (!ready || !query.trim()) return [];
  const q = query.toLowerCase();

  // Phase 1: Find all matching indices via pre-lowered strings
  const matched: number[] = [];
  for (let i = 0; i < searchIndex.length; i++) {
    const si = searchIndex[i];
    if (si.name.includes(q) || si.tsym.includes(q) || si.usym.includes(q)) {
      matched.push(i);
    }
  }

  // Phase 2: Sort by match quality → type priority → expiry
  matched.sort((ai, bi) => {
    const sa = searchIndex[ai], sb = searchIndex[bi];
    const a = instruments[ai], b = instruments[bi];
    // 1. Exact > prefix > substring
    const md = matchScore(sa, q) - matchScore(sb, q);
    if (md !== 0) return md;
    // 2. INDEX > EQ > FUT > Options
    const rd = typeRank(a) - typeRank(b);
    if (rd !== 0) return rd;
    // 3. Non-expired before expired
    const ea = a.expiry ?? Infinity;
    const eb = b.expiry ?? Infinity;
    const aExp = ea < now;
    const bExp = eb < now;
    if (aExp && !bExp) return 1;
    if (!aExp && bExp) return -1;
    // 4. Nearest expiry first
    return ea - eb;
  });

  // Return top 50
  return matched.slice(0, 50).map(i => instruments[i]);
}

// ── Message handler ──────────────────────────────────────────────────────────
self.onmessage = (e: MessageEvent) => {
  const { type } = e.data;

  if (type === 'BUILD' || type === 'LOAD') {
    const data = e.data.instruments ?? e.data.payload;
    buildIndex(data as Instrument[]);
    self.postMessage({ type: 'READY', total: instruments.length });
  }

  if (type === 'SEARCH') {
    const query = e.data.query ?? e.data.payload;
    const results = search(query as string);
    self.postMessage({ type: 'RESULTS', results });
  }
};
