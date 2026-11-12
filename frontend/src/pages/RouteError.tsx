import { AlertTriangle } from "lucide-react";
import { isRouteErrorResponse, Link, useRouteError } from "react-router-dom";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

/** Shown instead of a blank screen if a page crashes. Progress is saved on the server, so nothing is lost. */
export default function RouteError() {
  const error = useRouteError();
  useDocumentTitle("Something went wrong");
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : null;
  if (error) console.error(error);

  return (
    <div className="atmosphere relative grid min-h-dvh place-items-center px-4">
      <div className="panel relative z-10 max-w-lg border-blood-700/60 p-8">
        <p className="eyebrow flex items-center gap-2 text-blood-400">
          <AlertTriangle className="size-4" /> Something went wrong
        </p>
        <h1 className="mt-4 font-display text-4xl text-paper">The case file slipped out of our hands.</h1>
        <p className="mt-4 text-sm leading-relaxed text-smoke-300">
          Your progress is saved on the server, so nothing is lost. Reload the page, or head back to Detective HQ.
        </p>
        {detail && <p className="mt-4 font-mono text-xs break-words text-smoke-400">{detail}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={() => window.location.reload()} className="btn-primary">
            Reload
          </button>
          <Link to="/dashboard" className="btn-ghost" reloadDocument>
            Detective HQ
          </Link>
        </div>
      </div>
    </div>
  );
}
