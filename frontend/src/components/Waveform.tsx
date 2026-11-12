import { useMemo } from "react";

/**
 * Decorative waveform. Deterministic bar heights (seeded) so it doesn't jump between renders.
 * The real, playback-synced waveform lives in AudioPlayer.
 */
export function Waveform({
  bars = 48,
  seed = 7,
  animated = true,
  className = "",
}: {
  bars?: number;
  seed?: number;
  animated?: boolean;
  className?: string;
}) {
  const heights = useMemo(() => {
    let s = seed;
    const rand = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    return Array.from({ length: bars }, (_, i) => {
      const envelope = Math.sin((i / (bars - 1)) * Math.PI) * 0.75 + 0.25;
      return Math.max(0.08, envelope * (0.35 + rand() * 0.65));
    });
  }, [bars, seed]);

  return (
    <div className={`flex h-12 items-center gap-[3px] ${className}`} aria-hidden="true">
      {heights.map((h, i) => (
        <span
          key={i}
          className="w-[3px] origin-center rounded-full bg-gold-500/70"
          style={{
            height: `${h * 100}%`,
            animation: animated ? `wave 1.6s ease-in-out ${(i % 12) * 0.09}s infinite alternate` : undefined,
          }}
        />
      ))}
      <style>{`@keyframes wave { from { transform: scaleY(0.55); opacity: .55 } to { transform: scaleY(1); opacity: 1 } }`}</style>
    </div>
  );
}
