import { useId } from "react";
import type { Suspect } from "../api/client";

/**
 * Noir silhouette portrait: a backlit figure with a coloured rim light. No photos are used,
 * so suspects stay abstract and every case can be styled from data alone.
 */
export function SuspectPortrait({
  suspect,
  className = "",
}: {
  suspect: Pick<Suspect, "name" | "avatar">;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const { accent, initials, style } = suspect.avatar;
  const fig = "#0f0e0d";

  return (
    <svg
      viewBox="0 0 120 150"
      role="img"
      aria-label={`Portrait of ${suspect.name}`}
      className={`block bg-ink-850 ${className}`}
    >
      <defs>
        <radialGradient id={`lamp-${uid}`} cx="50%" cy="0%" r="85%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.38" />
          <stop offset="55%" stopColor={accent} stopOpacity="0.07" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`rim-${uid}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor={accent} stopOpacity="0.9" />
          <stop offset="45%" stopColor={accent} stopOpacity="0.05" />
          <stop offset="100%" stopColor={accent} stopOpacity="0.35" />
        </linearGradient>
      </defs>

      <rect width="120" height="150" fill={`url(#lamp-${uid})`} />

      {/* hair behind the head */}
      {style === "long_hair" && (
        <path d="M34 66 C32 34 88 34 86 66 L90 116 C80 112 76 104 74 94 L46 94 C44 104 40 112 30 116 Z" fill={fig} stroke={`url(#rim-${uid})`} strokeWidth="1.2" />
      )}

      {/* shoulders, neck, head */}
      <path d="M8 150 C12 118 36 106 60 106 C84 106 108 118 112 150 Z" fill={fig} stroke={`url(#rim-${uid})`} strokeWidth="1.4" />
      <rect x="51" y="86" width="18" height="24" fill={fig} />
      <ellipse cx="60" cy="66" rx="21" ry="25" fill={fig} stroke={`url(#rim-${uid})`} strokeWidth="1.4" />

      {style === "short_hair" && (
        <path d="M38 62 C36 38 84 36 82 62 C78 52 70 46 60 47 C50 46 42 52 38 62 Z" fill="#161412" stroke={`url(#rim-${uid})`} strokeWidth="1" />
      )}
      {style === "glasses" && (
        <g stroke={accent} strokeOpacity="0.7" strokeWidth="1.3" fill="none">
          <rect x="44" y="61" width="13" height="8" rx="2" />
          <rect x="63" y="61" width="13" height="8" rx="2" />
          <path d="M57 65 L63 65" />
        </g>
      )}
      {style === "cap" && (
        <g>
          <path d="M37 54 C38 34 82 34 83 54 Z" fill="#161412" stroke={`url(#rim-${uid})`} strokeWidth="1.2" />
          <path d="M33 54 L91 54 L87 59 L37 59 Z" fill="#1b1916" stroke={accent} strokeOpacity="0.4" strokeWidth="0.8" />
          <circle cx="60" cy="45" r="3" fill={accent} fillOpacity="0.8" />
        </g>
      )}

      <text x="112" y="142" textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize="8" letterSpacing="1.5" fill={accent} fillOpacity="0.8">
        {initials}
      </text>
    </svg>
  );
}
