import { Clock, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { api } from "../api/client";
import { useSession } from "../context/SessionContext";

const STAMPED = /^(\d{2}:\d{2})\s*·\s*(.+)$/;

/**
 * The player's own reconstruction of the morning. Entries are theirs (not checked against the truth);
 * time-stamped lines from evidence they've found can be added with one click.
 */
export function TimelineBuilder() {
  const { state, refresh } = useSession();
  const entries = state.board.my_timeline;
  const closed = state.progress.status !== "active";
  const [time, setTime] = useState("08:15");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestions = useMemo(() => {
    const have = new Set(entries.map((e) => `${e.time}|${e.text}`));
    return state.evidence.flatMap((ev) =>
      ev.details.flatMap((line) => {
        const m = STAMPED.exec(line);
        if (!m) return [];
        const s = { time: m[1], text: m[2], evidence_id: ev.id };
        return have.has(`${s.time}|${s.text}`) ? [] : [s];
      }),
    );
  }, [state.evidence, entries]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || !/^\d{2}:\d{2}$/.test(time)) return;
    if (await run(() => api.addTimeline(state.id, { time, text: t }))) setText("");
  }

  return (
    <section aria-labelledby="tl-h" className="panel p-5">
      <h2 id="tl-h" className="eyebrow flex items-center gap-2">
        <Clock className="size-3.5" /> Your timeline
      </h2>
      <p className="mt-2 text-xs text-smoke-400">
        Rebuild the morning minute by minute. Gaps and overlaps are where stories break.
      </p>

      {entries.length > 0 ? (
        <ol className="relative mt-5 space-y-3 border-l border-ink-600 pl-5">
          {entries.map((e) => (
            <li key={e.id} className="group relative">
              <span className="absolute top-1.5 -left-[25px] size-2 rounded-full bg-gold-500" aria-hidden="true" />
              <div className="flex items-start gap-3">
                <span className="font-mono text-sm text-gold-400 tabular-nums">{e.time}</span>
                <span className="min-w-0 flex-1 text-sm text-smoke-200">
                  {e.text}
                  {e.evidence_id && <span className="ml-2 font-mono text-[10px] text-smoke-400">{e.evidence_id}</span>}
                </span>
                {!closed && (
                  <button
                    type="button"
                    onClick={() => run(() => api.deleteTimeline(state.id, e.id))}
                    disabled={busy}
                    aria-label={`Remove ${e.time} ${e.text}`}
                    className="p-0.5 text-smoke-400 opacity-60 transition group-hover:opacity-100 hover:text-blood-400"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-5 rounded-sm border border-dashed border-ink-600 p-4 text-center text-sm text-smoke-400">
          Nothing pinned yet. Add times from the records below, or your own.
        </p>
      )}

      {!closed && (
        <form onSubmit={add} className="mt-5 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="tl-time">
            Time
          </label>
          <input
            id="tl-time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-28 rounded-sm border border-ink-600 bg-ink-950/70 px-2 py-2 font-mono text-sm text-paper focus:border-gold-700 focus:outline-none"
          />
          <label className="sr-only" htmlFor="tl-text">
            What happened
          </label>
          <input
            id="tl-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={200}
            placeholder="What happened at this time?"
            className="min-w-0 flex-1 rounded-sm border border-ink-600 bg-ink-950/70 px-3 py-2 text-sm text-paper placeholder:text-smoke-400 focus:border-gold-700 focus:outline-none"
          />
          <button type="submit" disabled={busy || !text.trim()} className="btn-ghost px-3 py-2 text-xs disabled:opacity-40">
            <Plus className="size-4" /> Add
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-xs text-blood-400">{error}</p>}

      {!closed && suggestions.length > 0 && (
        <div className="mt-5">
          <p className="font-mono text-[10px] tracking-[0.2em] text-smoke-400 uppercase">From your evidence</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <li key={`${s.evidence_id}-${s.time}-${s.text}`}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => api.addTimeline(state.id, s))}
                  className="inline-flex items-center gap-1.5 rounded-full border border-ink-600 px-2.5 py-1 text-xs text-smoke-300 transition hover:border-gold-700 hover:text-paper"
                >
                  <Plus className="size-3" />
                  <span className="font-mono text-gold-400">{s.time}</span> {s.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
