import { useRef, useState } from 'react';

interface SplitDividerProps {
  axis: 'col' | 'row';
  containerRef: React.RefObject<HTMLDivElement | null>;
  ratios: number[];
  splitIndex: number;
  onRatioChange: (newRatios: number[]) => void;
  style?: React.CSSProperties;
}

export function SplitDivider({
  axis, containerRef, ratios, splitIndex, onRatioChange, style,
}: SplitDividerProps) {
  const [active, setActive] = useState(false);
  const [hovered, setHovered] = useState(false);
  const startRef = useRef({ client: 0, ratioA: 0, totalPx: 0 });

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    const rect = containerRef.current!.getBoundingClientRect();
    // Subtract gap pixels from total to get available pane space
    const gapCount = ratios.length - 1;
    const totalPx = (axis === 'col' ? rect.width : rect.height) - gapCount * 4;

    startRef.current = {
      client: axis === 'col' ? e.clientX : e.clientY,
      ratioA: ratios[splitIndex],
      totalPx,
    };
    setActive(true);

    const onMove = (me: PointerEvent) => {
      const { client, ratioA, totalPx: px } = startRef.current;
      const delta = (axis === 'col' ? me.clientX : me.clientY) - client;
      const available = ratios[splitIndex] + ratios[splitIndex + 1];
      const MIN = 80 / px;
      const newA = Math.min(Math.max(ratioA + delta / px, MIN), available - MIN);
      const newRatios = [...ratios];
      newRatios[splitIndex] = newA;
      newRatios[splitIndex + 1] = available - newA;
      onRatioChange(newRatios);
    };

    const onUp = () => {
      setActive(false);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  const onDoubleClick = () => {
    const available = ratios[splitIndex] + ratios[splitIndex + 1];
    const equal = available / 2;
    const newRatios = [...ratios];
    newRatios[splitIndex] = equal;
    newRatios[splitIndex + 1] = equal;
    onRatioChange(newRatios);
  };

  const isCol = axis === 'col';
  const highlight = active || hovered;

  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...style,
        cursor: isCol ? 'col-resize' : 'row-resize',
        background: active
          ? 'rgba(255,152,0,0.55)'
          : highlight
            ? 'rgba(255,152,0,0.20)'
            : 'transparent',
        transition: active ? 'none' : 'background 0.15s',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Center line — row-divider only; col-divider uses its own background */}
      {!isCol && (
        <div style={{
          position: 'absolute',
          left: 0, right: 0, top: '50%', height: 1, transform: 'translateY(-50%)',
          background: highlight ? 'rgba(255,152,0,0.6)' : 'transparent',
          transition: active ? 'none' : 'background 0.15s',
          pointerEvents: 'none',
        }} />
      )}
    </div>
  );
}
