import { useCallback, useSyncExternalStore } from "react";
import type { Evidence } from "../api/client";
import { INITIAL_SOURCE } from "../lib/caseProgress";

// Which records this player has already looked at, so new finds can be flagged until they're opened.
// A per-browser convenience: if storage is unavailable, nothing is ever flagged as new.

const EVENT = "mc-seen-evidence";
const key = (sessionId: string) => `mc.seen.${sessionId}`;

function read(sessionId: string): string {
  try {
    return localStorage.getItem(key(sessionId)) ?? "[]";
  } catch {
    return "[]";
  }
}

export function useSeenEvidence(sessionId: string, evidence: Evidence[]) {
  const raw = useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(EVENT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    () => read(sessionId),
  );

  let seen: Set<string>;
  try {
    seen = new Set(JSON.parse(raw) as string[]);
  } catch {
    seen = new Set();
  }
  const unseen = evidence.filter((e) => e.source !== INITIAL_SOURCE && !seen.has(e.id)).map((e) => e.id);

  const markSeen = useCallback(
    (ids: string[]) => {
      try {
        const now = new Set<string>(JSON.parse(read(sessionId)) as string[]);
        const before = now.size;
        ids.forEach((i) => now.add(i));
        if (now.size === before) return;
        localStorage.setItem(key(sessionId), JSON.stringify([...now]));
        window.dispatchEvent(new Event(EVENT));
      } catch {
        /* storage unavailable */
      }
    },
    [sessionId],
  );

  return { unseen, markSeen };
}
