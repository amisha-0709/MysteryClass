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
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { Link, NavLink, Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import type { SessionState } from "../api/client";
import { SessionProvider, useSession } from "../context/SessionContext";
import { Logo } from "./Logo";

type Gate = (s: SessionState) => boolean;
const afterBriefing: Gate = (s) => s.progress.briefing_done;

export const CASE_STAGES: { path: string; label: string; icon: LucideIcon; open: Gate }[] = [
  { path: "briefing", label: "Briefing", icon: FileText, open: () => true },
  { path: "investigation", label: "Investigate", icon: Search, open: afterBriefing },
  { path: "interrogation", label: "Interrogate", icon: MessagesSquare, open: afterBriefing },
  { path: "board", label: "Evidence Board", icon: Waypoints, open: afterBriefing },
  { path: "accusation", label: "Accuse", icon: Gavel, open: afterBriefing },
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
          <CaseChrome />
        </SessionProvider>
      </div>
    </div>
  );
}

function TopBar({ right }: { right?: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-8">
      <Logo />
      {right}
    </div>
  );
}

function CaseChrome() {
  const { state } = useSession();
  const { pathname } = useLocation();
  const current = CASE_STAGES.find((s) => pathname.endsWith(`/${s.path}`));
  useDocumentTitle(current?.label, `Case ${state.case.number}`);

  if (current && !current.open(state)) {
    return <Navigate to={`/case/${state.case.id}/briefing`} replace />;
  }

  return (
    <>
      <header className="border-b border-ink-800 bg-ink-950/80 backdrop-blur">
        <TopBar
          right={
            <div className="flex items-center gap-4">
              <span className="hidden items-center gap-1.5 font-mono text-[11px] tracking-[0.15em] text-smoke-400 uppercase sm:flex">
                <FolderSearch className="size-3.5 text-gold-500" />
                {state.progress.evidence_found}/{state.progress.evidence_total} evidence
              </span>
              <span className="font-mono text-[11px] tracking-[0.2em] text-gold-500 uppercase">
                Case {state.case.number}
              </span>
            </div>
          }
        />
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2 sm:px-6" aria-label="Investigation stages">
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
              </NavLink>
            ) : (
              <span
                key={path}
                className="flex shrink-0 cursor-not-allowed items-center gap-2 border-b-2 border-transparent px-3 py-3 text-sm text-ink-600"
                title={path === "resolution" ? "Unlocks after your final accusation" : "Finish the briefing first"}
              >
                <Lock className="size-3.5" />
                {label}
              </span>
            ),
          )}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-8">
        <Outlet />
      </main>
    </>
  );
}
