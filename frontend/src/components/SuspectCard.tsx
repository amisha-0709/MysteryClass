import { ChevronDown, Quote } from "lucide-react";
import { useState } from "react";
import { api, type Suspect } from "../api/client";
import { AudioPlayer } from "./AudioPlayer";
import { SuspectPortrait } from "./SuspectPortrait";

export function SuspectCard({ suspect: s, sessionId }: { suspect: Suspect; sessionId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <article className="panel overflow-hidden">
      <div className="grid grid-cols-[96px_1fr] sm:grid-cols-[132px_1fr]">
        <SuspectPortrait suspect={s} className="h-full w-full" />
        <div className="p-4 sm:p-5">
          <h3 className="font-display text-2xl leading-tight text-paper">{s.name}</h3>
          <p className="mt-0.5 text-xs text-smoke-400">
            {s.role} · {s.age}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-smoke-300">{s.background}</p>
          <p className="mt-2 text-xs text-gold-400 italic">{s.personality}</p>
        </div>
      </div>

      <div className="border-t border-ink-700 p-4 sm:p-5">
        <p className="eyebrow">Statement · in their own voice</p>
        <AudioPlayer
          src={api.clipUrl(sessionId, `statement.${s.id}`)}
          label={`${s.name.split(" ")[0]}'s statement`}
          compact
          className="mt-3"
        />

        <p className="eyebrow mt-6">Key claims</p>
        <ul className="mt-3 space-y-2">
          {s.claims.map((c) => (
            <li key={c.id} className="flex gap-2.5 text-sm text-smoke-200">
              <Quote className="mt-0.5 size-3.5 shrink-0 text-gold-700" />
              {c.text}
            </li>
          ))}
        </ul>

        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-3 inline-flex min-h-8 items-center gap-1.5 py-1 text-xs font-medium text-smoke-400 transition hover:text-paper"
        >
          <ChevronDown className={`size-4 transition ${open ? "rotate-180" : ""}`} />
          {open ? "Hide" : "Read"} full statement transcript
        </button>
        {open && (
          <p className="mt-3 rounded-sm border border-ink-700 bg-ink-950/60 p-4 text-sm leading-relaxed text-smoke-200">
            “{s.statement}”
          </p>
        )}
      </div>
    </article>
  );
}
