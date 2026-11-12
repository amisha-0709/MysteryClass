import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type SessionState } from "../api/client";

interface SessionCtx {
  state: SessionState;
  setState: (s: SessionState) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; state: SessionState };

/** Starts or resumes the investigation for `caseId` and shares its server state with every case page. */
export function SessionProvider({
  caseId,
  children,
  fallback,
}: {
  caseId: string;
  children: ReactNode;
  fallback: (load: Exclude<Load, { status: "ready" }>) => ReactNode;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    api
      .startSession(caseId)
      .then((state) => !cancelled && setLoad({ status: "ready", state }))
      .catch((e: Error) => !cancelled && setLoad({ status: "error", message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  const setState = useCallback((state: SessionState) => setLoad({ status: "ready", state }), []);
  const sessionId = load.status === "ready" ? load.state.id : null;
  const refresh = useCallback(async () => {
    if (sessionId) setState(await api.session(sessionId));
  }, [sessionId, setState]);

  if (load.status !== "ready") return <>{fallback(load)}</>;
  return <Ctx.Provider value={{ state: load.state, setState, refresh }}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
