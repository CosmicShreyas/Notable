/**
 * Waveform visualizer that can react to a live audio level.
 */
export function Waveform({
  bars = 28,
  height = 40,
  color = "hsl(0 84% 60%)",
  level = 0,
}: {
  bars?: number;
  height?: number;
  color?: string;
  level?: number;
}) {
  return (
    <div className="flex items-center justify-center gap-[3px]" style={{ height }}>
      {Array.from({ length: bars }).map((_, i) => {
        const weight = 0.35 + (1 - Math.abs(i - bars / 2) / (bars / 2)) * 0.65;
        const reactiveLevel = Math.max(0.08, Math.min(1, level * weight));
        const baseH = 18 + reactiveLevel * 72;
        return (
          <span
            key={i}
            className="inline-block w-[3px] rounded-full"
            style={{
              height: `${baseH}%`,
              backgroundColor: color,
              transformOrigin: "center",
              opacity: 0.45 + reactiveLevel * 0.55,
              transition: "height 120ms ease, opacity 120ms ease",
            }}
          />
        );
      })}
    </div>
  );
}

/** Compact static waveform for idle / list previews. */
export function MiniWaveform({ count = 18 }: { count?: number }) {
  return (
    <div className="flex items-center gap-[2px]">
      {Array.from({ length: count }).map((_, i) => {
        const h = 4 + ((i * 31) % 14);
        return (
          <span
            key={i}
            className="inline-block w-[2px] rounded-full bg-foreground/40"
            style={{ height: `${h}px` }}
          />
        );
      })}
    </div>
  );
}
