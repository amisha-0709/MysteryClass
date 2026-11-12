import { NotebookPen, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import { useSession } from "../context/SessionContext";

export function NotesPanel() {
  const { state, refresh } = useSession();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function add(e?: FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (!t) return;
    if (await run(() => api.addNote(state.id, t))) setText("");
  }

  return (
    <section className="panel flex flex-col p-5" aria-labelledby="notes-h">
      <h2 id="notes-h" className="eyebrow flex items-center gap-2">
        <NotebookPen className="size-3.5" /> Detective's notebook
      </h2>

      <form onSubmit={add} className="mt-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) add();
          }}
          maxLength={2000}
          rows={3}
          placeholder="Times, doubts, hunches…"
          aria-label="New note for your notebook"
          className="w-full resize-y rounded-sm border border-ink-600 bg-ink-950/70 p-3 text-sm text-paper placeholder:text-smoke-400 focus:border-gold-700 focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-smoke-400">Ctrl + Enter to save</span>
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="rounded-sm border border-gold-700 px-3 py-1.5 text-xs font-semibold text-gold-400 transition hover:bg-gold-500 hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add note
          </button>
        </div>
      </form>
      {error && <p className="mt-2 text-xs text-blood-400">{error}</p>}

      <ol className="mt-5 space-y-2">
        {state.notes.length === 0 && <li className="text-sm text-smoke-400">No notes yet.</li>}
        {[...state.notes].reverse().map((n) => (
          <li key={n.id} className="group flex gap-3 rounded-sm border border-ink-700 bg-ink-950/50 p-3">
            <p className="flex-1 text-sm leading-relaxed whitespace-pre-wrap text-smoke-200">{n.text}</p>
            <button
              onClick={() => run(() => api.deleteNote(state.id, n.id))}
              disabled={busy}
              aria-label="Delete note"
              className="self-start text-smoke-400 opacity-60 transition group-hover:opacity-100 hover:text-blood-400"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
