import { CheckCircle2, FileSearch, Sparkles, X } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

export type ToastKind = "evidence" | "slip" | "proven";

export interface Toast {
  kind: ToastKind;
  title: string;
  body?: string;
  to?: string;
  action?: string;
}

const ICON = { evidence: FileSearch, slip: Sparkles, proven: CheckCircle2 };
const LIFETIME_MS = 5500;

const Ctx = createContext<(t: Toast) => void>(() => {});

/** Celebrates discoveries (new evidence, an admission, a proven lie) without blocking play. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<(Toast & { id: number })[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback(
    (t: Toast) => {
      const id = next.current++;
      setToasts((list) => [...list.slice(-2), { ...t, id }]);
      window.setTimeout(() => dismiss(id), LIFETIME_MS);
    },
    [dismiss],
  );

  return (
    <Ctx.Provider value={notify}>
      {children}
      {createPortal(
        <div
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-3 md:top-auto md:right-6 md:bottom-6 md:left-auto md:items-end"
        >
          {toasts.map((t) => {
            const Icon = ICON[t.kind];
            return (
              <div
                key={t.id}
                role="status"
                className="toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-sm border border-gold-700 bg-ink-900/95 p-3.5 shadow-2xl shadow-black/60 backdrop-blur"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-gold-700 bg-gold-500/10 text-gold-300">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-paper">{t.title}</p>
                  {t.body && <p className="mt-0.5 text-xs leading-snug text-smoke-300">{t.body}</p>}
                  {t.to && (
                    <Link
                      to={t.to}
                      onClick={() => dismiss(t.id)}
                      className="mt-1.5 inline-block text-xs font-medium text-gold-400 underline-offset-2 hover:underline"
                    >
                      {t.action ?? "View"}
                    </Link>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss"
                  className="-m-1 p-1 text-smoke-400 hover:text-paper"
                >
                  <X className="size-4" />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
