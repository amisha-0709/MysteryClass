import { useEffect, useState } from "react";

export type ApiState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

/** Runs an API call once on mount and tracks loading / error / ready. */
export function useApi<T>(fn: () => Promise<T>): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fn()
      .then((data) => !cancelled && setState({ status: "ready", data }))
      .catch((e: unknown) =>
        !cancelled &&
        setState({ status: "error", message: e instanceof Error ? e.message : "Unknown error" }),
      );
    return () => {
      cancelled = true;
    };
    // fn is expected to be a stable module-level function
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
