import type { Instrument } from './useInstruments';

// Worker holds its own copy of instruments in memory
let instruments: Instrument[] = [];

const now = Date.now();

// 0 = exact match, 1 = starts with, 2 = partial match
function matchScore(i: Instrument, q: string): number {
  const name = i.name?.toLowerCase() ?? '';
  const sym = i.underlying_symbol?.toLowerCase() ?? '';
  const tsym = i.trading_symbol?.toLowerCase() ?? '';
  if (name === q || sym === q || tsym === q) return 0;
  if (name.startsWith(q) || sym.startsWith(q) || tsym.startsWith(q)) return 1;
  return 2;
}

function rankForQuery(i: Instrument, hasNumber: boolean): number {
  const seg = i.segment?.toUpperCase() ?? '';
  const type = i.instrument_type?.toUpperCase() ?? '';
  if (hasNumber) {
    // Number in query → FO/futures first
    if (seg === 'NSE_FO') return 0;
    if (seg === 'BSE_FO') return 1;
    if (type === 'EQ') return 2;
    if (seg.includes('INDEX') || type === 'INDEX') return 3;
    return 4;
  }
  // No number → EQ first
  if (type === 'EQ') return 0;
  if (seg.includes('INDEX') || type === 'INDEX') return 1;
  if (seg === 'NSE_FO') return 2;
  if (seg === 'BSE_FO') return 3;
  return 4;
}

function search(query: string): Instrument[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const hasNumber = /\d/.test(q);

  const matched = instruments.filter(
    (i) =>
      i.name?.toLowerCase().includes(q) ||
      i.trading_symbol?.toLowerCase().includes(q) ||
      i.underlying_symbol?.toLowerCase().includes(q)
  );

  return matched
    .sort((a, b) => {
      // 1. Exact/prefix match wins over partial
      const md = matchScore(a, q) - matchScore(b, q);
      if (md !== 0) return md;
      // 2. Segment/type priority (context-aware)
      const rd = rankForQuery(a, hasNumber) - rankForQuery(b, hasNumber);
      if (rd !== 0) return rd;
      // 3. Within same group: nearest upcoming expiry first, expired last
      const ea = a.expiry ?? Infinity;
      const eb = b.expiry ?? Infinity;
      const aExp = ea < now;
      const bExp = eb < now;
      if (aExp && !bExp) return 1;
      if (!aExp && bExp) return -1;
      return ea - eb;
    })
    .slice(0, 50);
}

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'LOAD') {
    instruments = payload as Instrument[];
    self.postMessage({ type: 'READY', total: instruments.length });
  }

  if (type === 'SEARCH') {
    const results = search(payload as string);
    self.postMessage({ type: 'RESULTS', results });
  }
};
