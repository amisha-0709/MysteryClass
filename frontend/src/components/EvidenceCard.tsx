import {
  ClipboardList,
  FileText,
  FileWarning,
  Package,
  Receipt,
  ScrollText,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import type { Evidence, EvidenceKind } from "../api/client";

export const KIND_ICON: Record<EvidenceKind, LucideIcon> = {
  document: FileText,
  log: ScrollText,
  object: Package,
  record: ClipboardList,
  report: FileWarning,
  receipt: Receipt,
};

export function EvidenceCard({ item, onOpen }: { item: Evidence; onOpen: () => void }) {
  const Icon = KIND_ICON[item.kind];
  return (
    <button
      onClick={onOpen}
      className="panel group flex h-full flex-col p-5 text-left transition hover:-translate-y-0.5 hover:border-gold-700"
    >
      <div className="flex items-center justify-between">
        <span className="grid size-9 place-items-center rounded-sm border border-ink-600 text-gold-500 transition group-hover:border-gold-700">
          <Icon className="size-4" />
        </span>
        <span className="font-mono text-[11px] tracking-[0.2em] text-smoke-400">{item.id}</span>
      </div>
      <h3 className="mt-4 font-display text-xl leading-snug text-paper">{item.title}</h3>
      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-smoke-300">{item.summary}</p>
      <p className="mt-auto pt-4 font-mono text-[10px] tracking-[0.15em] text-smoke-400 uppercase">
        {item.found_at}
      </p>
    </button>
  );
}

/** Modal with the full evidence record. Uses the native <dialog> for focus trapping and Esc. */
export function EvidenceDialog({ item, onClose }: { item: Evidence | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (item && !d.open) d.showModal();
    if (!item && d.open) d.close();
  }, [item]);

  const Icon = item ? KIND_ICON[item.kind] : FileText;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(640px,calc(100vw-32px))] rounded-sm border border-ink-600 bg-ink-900 p-0 text-smoke-200 backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      {item && (
        <div className="p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-sm border border-gold-700 text-gold-500">
                <Icon className="size-5" />
              </span>
              <div>
                <p className="eyebrow">
                  Evidence {item.id} · {item.kind}
                </p>
                <h2 className="mt-1 font-display text-2xl leading-tight text-paper">{item.title}</h2>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" className="text-smoke-400 transition hover:text-paper">
              <X className="size-5" />
            </button>
          </div>

          <p className="mt-6 leading-relaxed text-smoke-300">{item.summary}</p>

          <ul className="mt-6 space-y-px overflow-hidden rounded-sm border border-ink-700 bg-ink-700">
            {item.details.map((line, i) => (
              <li key={i} className="bg-ink-950 px-4 py-3 font-mono text-[13px] leading-relaxed text-smoke-200">
                {line}
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-wrap justify-between gap-2 font-mono text-[10px] tracking-[0.15em] text-smoke-400 uppercase">
            <span>Found: {item.found_at}</span>
            <span>{item.source}</span>
          </div>
        </div>
      )}
    </dialog>
  );
}
