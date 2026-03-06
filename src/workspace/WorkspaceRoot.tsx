import { useRef, useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Instrument } from '../useInstruments';
import type { WorkspaceState, WorkspaceAction, ViewType, LayoutId } from './workspaceTypes';
import { LAYOUT_TEMPLATES, buildGridTemplate } from './layoutTemplates';
import { LayoutPicker } from './LayoutPicker';
import { SplitDivider } from './SplitDivider';
import { PaneShell } from './PaneShell';

// ── Interval definitions (mirrored from CandleChart) ─────────────────────────
const INTERVALS = [
  { label: '1m',  value: 'I1'  },
  { label: '5m',  value: 'I5'  },
  { label: '15m', value: 'I15' },
  { label: '30m', value: 'I30' },
];

// ── View options ─────────────────────────────────────────────────────────────
const VIEW_OPTIONS: { value: ViewType; label: string }[] = [
  { value: 'candle',    label: 'Candle' },
  { value: 'straddle',  label: 'Straddle' },
  { value: 'oiprofile', label: 'OI Profile' },
];

// ── Interval dropdown ────────────────────────────────────────────────────────
function IntervalDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const current = INTERVALS.find(i => i.value === value) ?? INTERVALS[0];

  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen(o => !o);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        title="Timeframe"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          height: 28, padding: '0 10px',
          background: open ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${open ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.09)'}`,
          borderRadius: 5, cursor: 'pointer',
          fontSize: 12, fontWeight: 700, color: '#FFFFFF',
          letterSpacing: '0.03em',
          transition: 'all 0.12s', whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => { if (!open) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.18)'; } }}
        onMouseLeave={e => { if (!open) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.09)'; } }}
      >
        {/* Clock icon */}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>
        </svg>
        {current.label}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2.5" strokeLinecap="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <path d="m19 9-7 7-7-7"/>
        </svg>
      </button>
      {open && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9500 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 9501,
            background: '#181B27',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 8, padding: '6px',
            minWidth: 130,
            boxShadow: '0 12px 40px rgba(0,0,0,0.75)',
          }}>
            <div style={{ padding: '4px 8px 6px', fontSize: 10, fontWeight: 700, color: '#4A4E5C', letterSpacing: '0.10em', textTransform: 'uppercase' }}>Timeframe</div>
            {INTERVALS.map(iv => {
              const active = iv.value === value;
              return (
                <button
                  key={iv.value}
                  onClick={() => { onChange(iv.value); setOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '7px 10px',
                    background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
                    border: 'none', borderRadius: 5, cursor: 'pointer',
                    fontSize: 13, fontWeight: active ? 700 : 500,
                    color: active ? '#FFFFFF' : '#9B9EA8',
                    transition: 'all 0.1s',
                  }}
                  onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLButtonElement).style.color = '#D1D4DC'; } }}
                  onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#9B9EA8'; } }}
                >
                  {iv.label}
                  {active && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

// ── Indicators dropdown ───────────────────────────────────────────────────────
const VWAP_ANCHORS: { id: VwapAnchor; label: string; short: string }[] = [
  { id: 'daily',   label: 'Daily',           short: 'D'   },
  { id: 'weekly',  label: 'Weekly',           short: 'W'   },
  { id: 'monthly', label: 'Monthly',          short: 'M'   },
  { id: 'expiry',  label: 'Expiry-to-Expiry', short: 'EXP' },
];

const VWAP_COLORS = ['#FFD700','#FF6B6B','#4ECDC4','#A78BFA','#F97316','#22C55E','#FFFFFF','#60A5FA'];

function IndicatorsDropdown({
  vwapShow, vwapAnchor, vwapColor, vwapExpiryDay, twapShow,
  onVwapToggle, onVwapAnchor, onVwapColor, onVwapExpiryDay, onTwapToggle,
}: {
  vwapShow: boolean; vwapAnchor: VwapAnchor; vwapColor: string; vwapExpiryDay: 'tuesday'|'thursday'; twapShow: boolean;
  onVwapToggle: () => void; onVwapAnchor: (a: VwapAnchor) => void; onVwapColor: (c: string) => void; onVwapExpiryDay: (d: 'tuesday'|'thursday') => void; onTwapToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const anyActive = vwapShow || twapShow;

  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen(o => !o);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        title="Indicators"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          height: 28, padding: '0 10px',
          background: anyActive ? 'rgba(255,215,0,0.10)' : open ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${anyActive ? 'rgba(255,215,0,0.35)' : open ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.09)'}`,
          borderRadius: 5, cursor: 'pointer',
          fontSize: 12, fontWeight: anyActive ? 700 : 600,
          color: anyActive ? '#FFD700' : '#C4C7D0',
          letterSpacing: '0.03em',
          transition: 'all 0.12s', whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => { if (!anyActive && !open) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.18)'; } }}
        onMouseLeave={e => { if (!anyActive && !open) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.09)'; } }}
      >
        {/* Indicators icon — trend line with dot */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 17 8 12 12 14 17 8 21 10"/>
          <circle cx="8" cy="12" r="1.5" fill="currentColor"/>
          <circle cx="17" cy="8" r="1.5" fill="currentColor"/>
        </svg>
        Indicators
        {anyActive && (
          <span style={{
            minWidth: 16, height: 16, borderRadius: 8, padding: '0 4px',
            background: '#FFD700', color: '#000', fontSize: 10, fontWeight: 800,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
          }}>
            {(vwapShow ? 1 : 0) + (twapShow ? 1 : 0)}
          </span>
        )}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', opacity: 0.5 }}>
          <path d="m19 9-7 7-7-7"/>
        </svg>
      </button>

      {open && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9500 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 9501,
            background: '#181B27',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 10, padding: '8px',
            width: 240,
            boxShadow: '0 16px 48px rgba(0,0,0,0.80), inset 0 1px 0 rgba(255,255,255,0.05)',
          }}>
            <div style={{ padding: '2px 6px 8px', fontSize: 10, fontWeight: 700, color: '#4A4E5C', letterSpacing: '0.10em', textTransform: 'uppercase' }}>Indicators</div>

            {/* ── VWAP row ── */}
            <div style={{
              borderRadius: 7,
              border: vwapShow ? '1px solid rgba(255,215,0,0.20)' : '1px solid rgba(255,255,255,0.06)',
              background: vwapShow ? 'rgba(255,215,0,0.05)' : 'rgba(255,255,255,0.02)',
              marginBottom: 6,
              overflow: 'hidden',
            }}>
              {/* VWAP toggle row */}
              <button
                onClick={onVwapToggle}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '9px 12px',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                {/* Toggle pill */}
                <span style={{
                  width: 32, height: 18, borderRadius: 9, flexShrink: 0,
                  background: vwapShow ? '#FFD700' : 'rgba(255,255,255,0.12)',
                  position: 'relative', transition: 'background 0.2s',
                  display: 'inline-block',
                }}>
                  <span style={{
                    position: 'absolute', top: 3, left: vwapShow ? 16 : 3,
                    width: 12, height: 12, borderRadius: '50%',
                    background: vwapShow ? '#000' : '#787B86',
                    transition: 'left 0.2s, background 0.2s',
                  }} />
                </span>
                {/* Line preview */}
                <svg width="28" height="14" viewBox="0 0 28 14" fill="none">
                  <path d="M1 10 L7 4 L14 7 L21 2 L27 5" stroke="#FFD700" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M1 12 L7 6 L14 9 L21 4 L27 7" stroke="rgba(255,215,0,0.4)" strokeWidth="1" strokeLinecap="round" strokeDasharray="2 2"/>
                </svg>
                <span style={{ flex: 1, textAlign: 'left' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: vwapShow ? '#FFFFFF' : '#9B9EA8', letterSpacing: '0.02em' }}>VWAP</div>
                  <div style={{ fontSize: 10, color: '#4A4E5C', marginTop: 1 }}>Volume Weighted Avg Price</div>
                </span>
              </button>

              {/* Settings — only when VWAP on */}
              {vwapShow && (
                <div style={{ borderTop: '1px solid rgba(255,215,0,0.12)', padding: '8px 12px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>

                  {/* Color row */}
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#4A4E5C', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Line Color</div>
                    <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                      {VWAP_COLORS.map(c => (
                        <button
                          key={c}
                          onClick={() => onVwapColor(c)}
                          title={c}
                          style={{
                            width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                            background: c, border: vwapColor === c ? '2px solid #FFFFFF' : '2px solid transparent',
                            cursor: 'pointer', padding: 0,
                            boxShadow: vwapColor === c ? `0 0 0 1px ${c}` : 'none',
                            transition: 'all 0.12s',
                          }}
                        />
                      ))}
                      {/* Custom color input */}
                      <label title="Custom color" style={{ position: 'relative', width: 20, height: 20, cursor: 'pointer', flexShrink: 0 }}>
                        <span style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: 20, height: 20, borderRadius: '50%',
                          background: 'rgba(255,255,255,0.08)',
                          border: '1.5px dashed rgba(255,255,255,0.25)',
                          fontSize: 12, color: '#787B86',
                        }}>+</span>
                        <input type="color" value={vwapColor} onChange={e => onVwapColor(e.target.value)}
                          style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none', padding: 0 }} />
                      </label>
                    </div>
                  </div>

                  {/* Anchor row */}
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#4A4E5C', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Anchor Period</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {VWAP_ANCHORS.map(a => {
                        const active = vwapAnchor === a.id;
                        return (
                          <button key={a.id} onClick={() => onVwapAnchor(a.id)}
                            style={{
                              height: 26, padding: '0 10px',
                              background: active ? 'rgba(255,215,0,0.15)' : 'rgba(255,255,255,0.05)',
                              border: active ? `1px solid ${vwapColor}88` : '1px solid rgba(255,255,255,0.08)',
                              borderRadius: 5, cursor: 'pointer',
                              fontSize: 11, fontWeight: active ? 700 : 500,
                              color: active ? vwapColor : '#787B86',
                              transition: 'all 0.12s',
                            }}
                            onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.10)'; (e.currentTarget as HTMLButtonElement).style.color = '#C4C7D0'; } }}
                            onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLButtonElement).style.color = '#787B86'; } }}
                          >
                            {a.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Expiry day — only when anchor = expiry */}
                  {vwapAnchor === 'expiry' && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#4A4E5C', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Expiry Day</div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {(['tuesday','thursday'] as const).map(d => {
                          const active = vwapExpiryDay === d;
                          return (
                            <button key={d} onClick={() => onVwapExpiryDay(d)}
                              style={{
                                height: 28, padding: '0 12px', borderRadius: 5, cursor: 'pointer',
                                background: active ? `${vwapColor}22` : 'rgba(255,255,255,0.05)',
                                border: active ? `1px solid ${vwapColor}88` : '1px solid rgba(255,255,255,0.08)',
                                fontSize: 12, fontWeight: active ? 700 : 500,
                                color: active ? vwapColor : '#787B86',
                                transition: 'all 0.12s',
                              }}
                              onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.10)'; (e.currentTarget as HTMLButtonElement).style.color = '#C4C7D0'; } }}
                              onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLButtonElement).style.color = '#787B86'; } }}
                            >
                              {d === 'tuesday' ? 'Tuesday' : 'Thursday'}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── TWAP row ── */}
            <div style={{
              borderRadius: 7,
              border: twapShow ? '1px solid rgba(0,191,255,0.20)' : '1px solid rgba(255,255,255,0.06)',
              background: twapShow ? 'rgba(0,191,255,0.05)' : 'rgba(255,255,255,0.02)',
              overflow: 'hidden',
            }}>
              <button
                onClick={onTwapToggle}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '9px 12px',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                <span style={{
                  width: 32, height: 18, borderRadius: 9, flexShrink: 0,
                  background: twapShow ? '#00BFFF' : 'rgba(255,255,255,0.12)',
                  position: 'relative', transition: 'background 0.2s',
                  display: 'inline-block',
                }}>
                  <span style={{
                    position: 'absolute', top: 3, left: twapShow ? 16 : 3,
                    width: 12, height: 12, borderRadius: '50%',
                    background: twapShow ? '#000' : '#787B86',
                    transition: 'left 0.2s, background 0.2s',
                  }} />
                </span>
                <svg width="28" height="14" viewBox="0 0 28 14" fill="none">
                  <path d="M1 8 L5 5 L10 9 L15 4 L20 7 L27 3" stroke="#00BFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 2"/>
                </svg>
                <span style={{ flex: 1, textAlign: 'left' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: twapShow ? '#FFFFFF' : '#9B9EA8', letterSpacing: '0.02em' }}>TWAP</div>
                  <div style={{ fontSize: 10, color: '#4A4E5C', marginTop: 1 }}>Time Weighted Avg Price</div>
                </span>
              </button>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

// ── View selector dropdown ────────────────────────────────────────────────────
function ViewSelector({ value, onChange }: { value: ViewType; onChange: (v: ViewType) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const current = VIEW_OPTIONS.find(o => o.value === value)!;

  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen(o => !o);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          height: 28, padding: '0 8px',
          background: 'transparent',
          border: '1px solid transparent',
          borderRadius: 4, cursor: 'pointer',
          fontSize: 12, fontWeight: 500, color: '#9B9EA8',
          transition: 'background 0.1s, color 0.1s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.07)'; (e.currentTarget as HTMLButtonElement).style.color = '#D1D4DC'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#9B9EA8'; }}
      >
        {current.label}
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <path d="m19 9-7 7-7-7"/>
        </svg>
      </button>
      {open && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9500 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'fixed', top: pos.top, left: pos.left,
            zIndex: 9501,
            background: '#1C1E27',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 6, padding: '4px 0',
            minWidth: 120,
            boxShadow: '0 8px 24px rgba(0,0,0,0.7)',
          }}>
            {VIEW_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '7px 12px',
                  background: 'transparent', border: 'none', borderRadius: 0,
                  fontSize: 12, fontWeight: opt.value === value ? 600 : 400,
                  color: opt.value === value ? '#FF9800' : '#C4C7D0',
                  cursor: 'pointer', textAlign: 'left',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.07)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                {opt.label}
                {opt.value === value && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FF9800" strokeWidth="3" strokeLinecap="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

// ── Layout button ─────────────────────────────────────────────────────────────
function LayoutButton({ activeLayout, onLayoutChange }: { activeLayout: LayoutId; onLayoutChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        title="Change layout"
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 30, height: 28,
          background: open ? 'rgba(255,152,0,0.10)' : 'transparent',
          border: `1px solid ${open ? 'rgba(255,152,0,0.45)' : 'transparent'}`,
          borderRadius: 4, cursor: 'pointer',
          color: open ? '#FF9800' : '#787B86',
          transition: 'background 0.12s, border-color 0.12s, color 0.12s',
        }}
        onMouseEnter={e => { if (!open) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.07)'; (e.currentTarget as HTMLButtonElement).style.color = '#C4C7D0'; } }}
        onMouseLeave={e => { if (!open) { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#787B86'; } }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
        </svg>
      </button>
      {open && (
        <LayoutPicker
          anchorRef={btnRef}
          activeLayout={activeLayout}
          onSelect={id => { onLayoutChange(id); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ── VWAP anchor type (mirrored from CandleChart) ─────────────────────────────
type VwapAnchor = 'daily' | 'weekly' | 'monthly' | 'expiry';

// ── VWAP Settings Panel ───────────────────────────────────────────────────────
function VwapSettingsPanel({
  anchorRef, panelRef, anchor, onAnchor, onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  panelRef:  React.RefObject<HTMLDivElement | null>;
  anchor:    VwapAnchor;
  onAnchor:  (a: VwapAnchor) => void;
  onClose:   () => void;
}) {
  const pos = useMemo(() => {
    if (anchorRef.current) {
      const r = anchorRef.current.getBoundingClientRect();
      return { top: r.bottom + 6, right: window.innerWidth - r.right };
    }
    return { top: 0, right: 0 };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!anchorRef.current?.contains(t) && !panelRef.current?.contains(t)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [anchorRef, panelRef, onClose]);

  const anchors: { id: VwapAnchor; label: string; sub: string }[] = [
    { id: 'daily',   label: 'Daily',           sub: 'Reset at 9:15 AM IST each day'     },
    { id: 'weekly',  label: 'Weekly',           sub: 'Reset each Monday'                  },
    { id: 'monthly', label: 'Monthly',          sub: 'Reset at month start'               },
    { id: 'expiry',  label: 'Expiry-to-Expiry', sub: 'Reset at each F&O expiry boundary'  },
  ];

  return createPortal(
    <div ref={panelRef as React.RefObject<HTMLDivElement>} style={{
      position: 'fixed', top: pos.top, right: pos.right, zIndex: 9999,
      width: 260, background: 'rgba(18,20,28,0.97)',
      border: '1px solid rgba(255,255,255,0.10)', borderRadius: 10,
      boxShadow: '0 16px 48px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.07)',
      backdropFilter: 'blur(20px)', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: '#D1D4DC', textTransform: 'uppercase' }}>VWAP Anchor</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4A4E5C', padding: 2, display: 'flex', alignItems: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 18 17.94 6M18 18 6.06 6"/></svg>
        </button>
      </div>
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {anchors.map(a => {
          const active = anchor === a.id;
          return (
            <button key={a.id} onClick={() => { onAnchor(a.id); onClose(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '9px 12px', borderRadius: 7, cursor: 'pointer', width: '100%', textAlign: 'left',
                border: active ? '1px solid rgba(255,215,0,0.40)' : '1px solid rgba(255,255,255,0.07)',
                background: active ? 'rgba(255,215,0,0.08)' : 'rgba(255,255,255,0.03)', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.03)'; }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: active ? '#FFD700' : '#363A45' }} />
              <span style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: active ? '#FFD700' : '#9B9EA8' }}>{a.label}</div>
                <div style={{ fontSize: 10, color: '#4A4E5C', marginTop: 1 }}>{a.sub}</div>
              </span>
              {active && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFD700" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
            </button>
          );
        })}
      </div>
    </div>,
    document.body
  );
}

// ── WorkspaceToolbar ──────────────────────────────────────────────────────────
interface WorkspaceToolbarProps {
  state: WorkspaceState;
  dispatch: React.Dispatch<WorkspaceAction>;
  activePaneId: string | null;
  onSearchOpen: () => void;
  instruments: Instrument[];
  openOiSettingsRef: { current: (() => void) | null };
  oiSettingsAnchorRef: React.RefObject<HTMLButtonElement | null>;
}

function WorkspaceToolbar({ state, dispatch, activePaneId, onSearchOpen, instruments, openOiSettingsRef, oiSettingsAnchorRef }: WorkspaceToolbarProps) {
  const activePane = state.panes.find(p => p.id === activePaneId) ?? state.panes[0];
  if (!activePane) return null;

  const interval = activePane.interval ?? 'I1';
  const oiShow = activePane.oiShow ?? false;
  const optionChainOpen = activePane.optionChainOpen ?? false;
  const vwapShow      = activePane.vwapShow      ?? false;
  const vwapAnchor    = activePane.vwapAnchor    ?? 'daily';
  const vwapColor     = activePane.vwapColor     ?? '#FFD700';
  const vwapExpiryDay = activePane.vwapExpiryDay ?? 'thursday';
  const twapShow      = activePane.twapShow      ?? false;

  // Mirror hasOptions logic from CandleChart
  const ins = activePane.instrument;
  const hasOptions = ins
    ? (ins.instrument_type === 'INDEX' || ins.instrument_type === 'EQ'
        ? true
        : (ins.instrument_type === 'FUT' || ins.instrument_type === 'CE' || ins.instrument_type === 'PE')
          ? instruments.some(i => (i.instrument_type === 'CE' || i.instrument_type === 'PE') && i.underlying_symbol === ins.underlying_symbol)
          : false)
    : false;

  const SEP = <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.08)', margin: '0 6px', flexShrink: 0 }} />;

  return (
    <div style={{
      height: 38, flexShrink: 0,
      display: 'flex', alignItems: 'center',
      padding: '0 8px', gap: 0,
      background: '#131722',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      overflow: 'hidden', minWidth: 0,
    }}>

      {/* ── Symbol search button ── */}
      <button
        onClick={onSearchOpen}
        title="Search symbol"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 30, padding: '0 12px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.09)',
          borderRadius: 5, cursor: 'pointer',
          marginRight: 4, flexShrink: 0,
          minWidth: 160, maxWidth: 280,
          transition: 'background 0.12s, border-color 0.12s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.16)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.09)'; }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#6B6E7A" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}>
          <circle cx="11" cy="11" r="7"/><path d="m21 21-4-4"/>
        </svg>
        {activePane.instrument ? (
          <>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#D1D4DC', letterSpacing: '0.03em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activePane.instrument.name || activePane.instrument.trading_symbol}
            </span>
            <span style={{ fontSize: 10, color: '#5D606B', whiteSpace: 'nowrap', flexShrink: 0 }}>NSE</span>
          </>
        ) : (
          <span style={{ fontSize: 12, color: '#5D606B' }}>Search symbol…</span>
        )}
      </button>

      {SEP}

      {/* ── Timeframe dropdown — candle view only ── */}
      {activePane.viewType === 'candle' && (
        <>
          <IntervalDropdown
            value={interval}
            onChange={v => dispatch({ type: 'SET_INTERVAL', paneId: activePane.id, interval: v })}
          />
          {SEP}
        </>
      )}

      {/* ── View type selector ── */}
      <ViewSelector
        value={activePane.viewType}
        onChange={v => dispatch({ type: 'SET_VIEW', paneId: activePane.id, viewType: v })}
      />

      {/* ── Indicators dropdown — candle only ── */}
      {activePane.viewType === 'candle' && (
        <>
          <IndicatorsDropdown
            vwapShow={vwapShow}
            vwapAnchor={vwapAnchor}
            vwapColor={vwapColor}
            vwapExpiryDay={vwapExpiryDay}
            twapShow={twapShow}
            onVwapToggle={() => dispatch({ type: 'SET_VWAP_SHOW', paneId: activePane.id, vwapShow: !vwapShow })}
            onVwapAnchor={a => dispatch({ type: 'SET_VWAP_ANCHOR', paneId: activePane.id, vwapAnchor: a })}
            onVwapColor={c => dispatch({ type: 'SET_VWAP_COLOR', paneId: activePane.id, vwapColor: c })}
            onVwapExpiryDay={d => dispatch({ type: 'SET_VWAP_EXPIRY_DAY', paneId: activePane.id, vwapExpiryDay: d })}
            onTwapToggle={() => dispatch({ type: 'SET_TWAP_SHOW', paneId: activePane.id, twapShow: !twapShow })}
          />
          {SEP}
        </>
      )}

      {/* ── OI Profile + OC Panel — candle + has options only ── */}
      {activePane.viewType === 'candle' && hasOptions && (
        <>
          {SEP}

          {/* OI Profile */}
          <button
            onClick={() => dispatch({ type: 'SET_OI_SHOW', paneId: activePane.id, oiShow: !oiShow })}
            title="Toggle OI profile overlay"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              height: 26, padding: '0 9px',
              background: oiShow ? 'rgba(46,189,133,0.10)' : 'transparent',
              border: oiShow ? '1px solid rgba(46,189,133,0.30)' : '1px solid transparent',
              borderRadius: 4, cursor: 'pointer',
              fontSize: 11, fontWeight: oiShow ? 600 : 400,
              color: oiShow ? '#2ebd85' : '#787B86',
              transition: 'all 0.12s', whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => { if (!oiShow) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLButtonElement).style.color = '#C4C7D0'; } }}
            onMouseLeave={e => { if (!oiShow) { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#787B86'; } }}
          >
            <span style={{
              width: 13, height: 13, borderRadius: 3, flexShrink: 0,
              border: oiShow ? '1.5px solid #2ebd85' : '1.5px solid #3D4150',
              background: oiShow ? 'rgba(46,189,133,0.18)' : 'transparent',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.12s',
            }}>
              {oiShow && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#2ebd85" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
            </span>
            OI Profile
          </button>

          {/* OI Settings gear — only when OI active */}
          {oiShow && (
            <button
              ref={oiSettingsAnchorRef}
              onClick={() => openOiSettingsRef.current?.()}
              title="OI Profile Settings"
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                height: 26, width: 28,
                background: 'transparent', border: '1px solid transparent',
                borderRadius: 4, cursor: 'pointer',
                color: '#6B6E7A', transition: 'all 0.12s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLButtonElement).style.color = '#C4C7D0'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#6B6E7A'; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          )}

          {/* OC Panel */}
          <button
            onClick={() => dispatch({ type: 'SET_OC_OPEN', paneId: activePane.id, optionChainOpen: !optionChainOpen })}
            title="Toggle option chain panel"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              height: 26, padding: '0 9px',
              background: optionChainOpen ? 'rgba(255,152,0,0.10)' : 'transparent',
              border: optionChainOpen ? '1px solid rgba(255,152,0,0.30)' : '1px solid transparent',
              borderRadius: 4, cursor: 'pointer',
              fontSize: 11, fontWeight: optionChainOpen ? 600 : 400,
              color: optionChainOpen ? '#FF9800' : '#787B86',
              transition: 'all 0.12s', whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => { if (!optionChainOpen) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLButtonElement).style.color = '#C4C7D0'; } }}
            onMouseLeave={e => { if (!optionChainOpen) { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#787B86'; } }}
          >
            <span style={{
              width: 13, height: 13, borderRadius: 3, flexShrink: 0,
              border: optionChainOpen ? '1.5px solid #FF9800' : '1.5px solid #3D4150',
              background: optionChainOpen ? 'rgba(255,152,0,0.18)' : 'transparent',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.12s',
            }}>
              {optionChainOpen && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#FF9800" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
            </span>
            OC Panel
          </button>
        </>
      )}

      {/* ── Layout picker ── */}
      {SEP}
      <LayoutButton
        activeLayout={state.activeLayout}
        onLayoutChange={id => dispatch({ type: 'SET_LAYOUT', layoutId: id as LayoutId })}
      />
    </div>
  );
}

// ── WorkspaceRoot ─────────────────────────────────────────────────────────────
interface WorkspaceRootProps {
  state: WorkspaceState;
  dispatch: React.Dispatch<WorkspaceAction>;
  instruments: Instrument[];
  activePaneId: string | null;
  onPaneClick: (paneId: string) => void;
  onPaneSearch: (paneId: string, onSelect: (ins: Instrument) => void) => void;
}

export function WorkspaceRoot({
  state, dispatch, instruments, activePaneId, onPaneClick, onPaneSearch,
}: WorkspaceRootProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const template = LAYOUT_TEMPLATES.find(t => t.id === state.activeLayout)!;

  const colRatios = state.splitRatios['col'] ?? Array(template.cols).fill(1 / template.cols);
  const rowRatios = state.splitRatios['row'] ?? Array(template.rows).fill(1 / template.rows);

  const gridTemplateColumns = buildGridTemplate(colRatios);
  const gridTemplateRows    = buildGridTemplate(rowRatios);

  const activeOrFirstPaneId = activePaneId ?? state.panes[0]?.id ?? null;

  // OI settings refs — shared between toolbar button and active CandleChart
  const openOiSettingsRef = useRef<(() => void) | null>(null);
  const oiSettingsAnchorRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#0e1117' }}>

      {/* ── Single toolbar above all panes — TradingView style ── */}
      <WorkspaceToolbar
        state={state}
        dispatch={dispatch}
        activePaneId={activeOrFirstPaneId}
        instruments={instruments}
        openOiSettingsRef={openOiSettingsRef}
        oiSettingsAnchorRef={oiSettingsAnchorRef}
        onSearchOpen={() => {
          const targetId = activeOrFirstPaneId;
          if (targetId) {
            onPaneSearch(targetId, ins => dispatch({ type: 'SET_INSTRUMENT', paneId: targetId, instrument: ins }));
          }
        }}
      />

      {/* ── Pane grid ── */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns,
          gridTemplateRows,
          minHeight: 0,
          userSelect: 'none',
          overflow: 'hidden',
        }}
      >
        {/* Panes */}
        {template.areas.map((area, i) => {
          const pane = state.panes[i];
          if (!pane) return null;
          return (
            <PaneShell
              key={pane.id}
              style={{ gridArea: area }}
              pane={pane}
              instruments={instruments}
              isActive={pane.id === activePaneId}
              onPaneClick={() => onPaneClick(pane.id)}
              onViewChange={v => dispatch({ type: 'SET_VIEW', paneId: pane.id, viewType: v })}
              onInstrumentChange={ins => dispatch({ type: 'SET_INSTRUMENT', paneId: pane.id, instrument: ins })}
              onSearchOpen={() => onPaneSearch(
                pane.id,
                ins => dispatch({ type: 'SET_INSTRUMENT', paneId: pane.id, instrument: ins })
              )}
              activeLayout={state.activeLayout}
              onLayoutChange={id => dispatch({ type: 'SET_LAYOUT', layoutId: id as LayoutId })}
              onIntervalChange={iv => dispatch({ type: 'SET_INTERVAL', paneId: pane.id, interval: iv })}
              onOiShowChange={v => dispatch({ type: 'SET_OI_SHOW', paneId: pane.id, oiShow: v })}
              onOptionChainOpenChange={v => dispatch({ type: 'SET_OC_OPEN', paneId: pane.id, optionChainOpen: v })}
              openOiSettingsRef={pane.id === activeOrFirstPaneId ? openOiSettingsRef : undefined}
              oiSettingsAnchorRef={pane.id === activeOrFirstPaneId ? oiSettingsAnchorRef : undefined}
              onVwapShowChange={v => dispatch({ type: 'SET_VWAP_SHOW', paneId: pane.id, vwapShow: v })}
              onVwapAnchorChange={a => dispatch({ type: 'SET_VWAP_ANCHOR', paneId: pane.id, vwapAnchor: a })}
              onVwapColorChange={c => dispatch({ type: 'SET_VWAP_COLOR', paneId: pane.id, vwapColor: c })}
              onVwapExpiryDayChange={d => dispatch({ type: 'SET_VWAP_EXPIRY_DAY', paneId: pane.id, vwapExpiryDay: d })}
              onTwapShowChange={v => dispatch({ type: 'SET_TWAP_SHOW', paneId: pane.id, twapShow: v })}
            />
          );
        })}

        {/* Column dividers — one segment per pane row so they don't bleed across rows */}
        {Array.from({ length: template.cols - 1 }, (_, ci) =>
          Array.from({ length: template.rows }, (__, ri) => (
            <SplitDivider
              key={`col-${ci}-row-${ri}`}
              axis="col"
              containerRef={containerRef}
              ratios={colRatios}
              splitIndex={ci}
              onRatioChange={r => dispatch({ type: 'SET_RATIO', key: 'col', ratios: r })}
              style={{ gridColumn: ci * 2 + 2, gridRow: ri * 2 + 1 }}
            />
          ))
        )}

        {/* Row dividers */}
        {Array.from({ length: template.rows - 1 }, (_, i) => (
          <SplitDivider
            key={`row-${i}`}
            axis="row"
            containerRef={containerRef}
            ratios={rowRatios}
            splitIndex={i}
            onRatioChange={r => dispatch({ type: 'SET_RATIO', key: 'row', ratios: r })}
            style={{ gridRow: i * 2 + 2, gridColumn: `1 / ${template.cols * 2}` }}
          />
        ))}
      </div>
    </div>
  );
}
