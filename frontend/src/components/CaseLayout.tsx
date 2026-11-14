import {
  FileText,
  FolderSearch,
  Gavel,
  Lock,
  MessagesSquare,
  Search,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import type { SessionState } from "../api/client";
import { SessionProvider, useSession } from "../context/SessionContext";
import { ToastProvider } from "../context/ToastContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useSeenEvidence } from "../hooks/useSeenEvidence";
import { ProgressChip } from "./CaseProgress";
import { Logo } from "./Logo";

type Gate = (s: SessionState) => boolean;
const afterBriefing: Gate = (s) => s.progress.briefing_done;

export const CASE_STAGES: { path: string; label: string; short: string; icon: LucideIcon; open: Gate }[] = [
  { path: "briefing", label: "Briefing", short: "Brief", icon: FileText, open: () => true },
  { path: "investigation", label: "Investigate", short: "Files", icon: Search, open: afterBriefing },
  { path: "interrogation", label: "Interrogate", short: "Question", icon: MessagesSquare, open: afterBriefing },
  { path: "board", label: "Evidence Board", short: "Board", icon: Waypoints, open: afterBriefing },
  { path: "accusation", label: "Accuse", short: "Accuse", icon: Gavel, open: afterBriefing },
];

/** Chrome shared by every in-case page. Starts/resumes the session and enforces stage order. */
export function CaseLayout() {
  const { caseId = "" } = useParams();

  return (
    <div className="atmosphere relative min-h-dvh">
      <div className="relative z-10 flex min-h-dvh flex-col">
        <SessionProvider
          caseId={caseId}
          fallback={(load) => (
            <>
              <TopBar />
              <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-16 sm:px-8">
                {load.status === "loading" ? (
                  <p className="eyebrow animate-pulse">Pulling the case file…</p>
                ) : (
                  <div className="panel max-w-xl border-blood-700/60 p-8">
                    <p className="eyebrow text-blood-400">Can't open this case</p>
                    <p className="mt-3 text-sm text-smoke-300">{load.message}</p>
                    <Link to="/dashboard" className="btn-ghost mt-6">
                      Back to Detective HQ
                    </Link>
                  </div>
                )}
              </main>
            </>
          )}
        >
          <ToastProvider>
            <CaseChrome />
          </ToastProvider>
        </SessionProvider>
      </div>
    </div>
  );
}

function TopBar({ right }: { right?: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-8 sm:py-4">
      <Logo />
      {right}
    </div>
  );
}

type BadgeInfo = { n: number; tone: "new" | "count" };

function CaseChrome() {
  const { state } = useSession();
  const { pathname } = useLocation();
  const current = CASE_STAGES.find((s) => pathname.endsWith(`/${s.path}`));
  const { unseen } = useSeenEvidence(state.id, state.evidence);
  useDocumentTitle(current?.label, `Case ${state.case.number}`);

  if (current && !current.open(state)) {
    return <Navigate to={`/case/${state.case.id}/briefing`} replace />;
  }

  // Small counts on the tabs: new records waiting to be read, lies proven so far.
  const badge: Record<string, BadgeInfo | undefined> = {
    investigation: unseen.length ? { n: unseen.length, tone: "new" } : undefined,
    board: state.board.found.length ? { n: state.board.found.length, tone: "count" } : undefined,
  };

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/90 backdrop-blur">
        <TopBar
          right={
            <div className="flex items-center gap-3 sm:gap-4">
              <span
                className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.15em] text-smoke-400 uppercase"
                title="Evidence found"
              >
                <FolderSearch className="size-3.5 text-gold-500" aria-hidden="true" />
                <span className="sr-only">Evidence found: </span>
                {state.progress.evidence_found}/{state.progress.evidence_total}
                <span className="hidden sm:inline" aria-hidden="true">
                  evidence
                </span>
              </span>
              {state.progress.briefing_done && <ProgressChip />}
              <span className="hidden font-mono text-[11px] tracking-[0.2em] text-gold-500 uppercase sm:inline">
                Case {state.case.number}
              </span>
            </div>
          }
        />
        <nav className="mx-auto hidden max-w-7xl gap-1 px-6 md:flex" aria-label="Investigation stages">
          {CASE_STAGES.map(({ path, label, icon: Icon, open }) =>
            open(state) ? (
              <NavLink
                key={path}
                to={`/case/${state.case.id}/${path}`}
                className={({ isActive }) =>
                  `flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm transition ${
                    isActive ? "border-gold-500 text-paper" : "border-transparent text-smoke-400 hover:text-smoke-200"
                  }`
                }
              >
                <Icon className="size-4" />
                {label}
                {badge[path] && <Badge {...badge[path]} />}
              </NavLink>
            ) : (
              <span
                key={path}
                className="flex shrink-0 cursor-not-allowed items-center gap-2 border-b-2 border-transparent px-3 py-3 text-sm text-ink-600"
                title="Finish the briefing first"
              >
                <Lock className="size-3.5" />
                {label}
              </span>
            ),
          )}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-6 pb-[calc(var(--tabbar-h)+2rem)] sm:px-8 md:py-10">
        <Outlet />
      </main>

      {/* Phones: stage navigation within thumb reach. */}
      <nav
        aria-label="Investigation stages"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-700 bg-ink-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="mx-auto grid h-16 max-w-lg grid-cols-5">
          {CASE_STAGES.map(({ path, short, label, icon: Icon, open }) => (
            <li key={path} className="flex">
              {open(state) ? (
                <NavLink
                  to={`/case/${state.case.id}/${path}`}
                  aria-label={label}
                  className={({ isActive }) =>
                    `relative flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium tracking-wide transition ${
                      isActive ? "text-gold-300" : "text-smoke-400 active:text-paper"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span className="absolute top-0 h-0.5 w-8 rounded-full bg-gold-500" aria-hidden="true" />
                      )}
                      <span className="relative">
                        <Icon className="size-5" />
                        {badge[path] && <Badge {...badge[path]} floating />}
                      </span>
                      {short}
                    </>
                  )}
                </NavLink>
              ) : (
                <span
                  aria-label={`${label} (locked until you finish the briefing)`}
                  className="flex flex-1 flex-col items-center justify-center gap-1 text-[10px] text-ink-600"
                >
                  <Lock className="size-5" />
                  {short}
                </span>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

function Badge({ n, tone, floating = false }: BadgeInfo & { floating?: boolean }) {
  return (
    <span
      aria-label={tone === "new" ? `${n} new` : String(n)}
      className={`grid min-w-4 place-items-center rounded-full px-1 font-mono text-[9px] leading-4 font-semibold ${
        tone === "new" ? "bg-blood-500 text-paper" : "bg-ink-700 text-gold-300"
      } ${floating ? "absolute -top-1.5 -right-2.5" : ""}`}
    >
      {n}
    </span>
  );
}
