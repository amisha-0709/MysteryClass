import { ArrowRight, Award, BadgeCheck, Check, FolderOpen, Lock, Pencil, Trophy, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, type CaseListItem, type HistoryItem, type Player } from "../api/client";
import { Logo } from "../components/Logo";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

const STATUS_LABEL: Record<CaseListItem["status"], string> = {
  new: "New",
  active: "In progress",
  closed: "Closed",
};

export default function Dashboard() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [cases, setCases] = useState<CaseListItem[] | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  useDocumentTitle("Detective HQ");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.me(), api.cases(), api.history()])
      .then(([p, c, h]) => {
        setPlayer(p);
        setCases(c);
        setHistory(h);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // A closed case can be replayed, so every case stays in the playable list.
  const open = cases ?? [];

  return (
    <div className="atmosphere relative min-h-dvh">
      <div className="relative z-10">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6 sm:px-8">
          <Logo />
        </header>

        <main className="mx-auto max-w-6xl px-4 pb-20 sm:px-8">
          <p className="eyebrow animate-rise">Detective HQ</p>

          {error && <div className="panel mt-6 border-blood-700/60 p-6 text-sm text-blood-400">{error}</div>}

          {!player && !error && <div className="panel mt-6 h-40 animate-pulse" />}
          {player && <ProfileCard player={player} onChange={setPlayer} />}

          <section className="mt-14">
            <h2 className="flex items-center gap-2 font-display text-2xl font-semibold text-paper">
              <BadgeCheck className="size-5 text-gold-500" /> Available cases
            </h2>
            <div className="mt-5 grid gap-4">
              {!cases && !error && <div className="panel h-24 animate-pulse" />}
              {open.map((c) => (
                <Link
                  key={c.id}
                  to={`/case/${c.id}/briefing`}
                  className="panel group flex items-center justify-between gap-6 p-6 transition hover:border-gold-700"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="eyebrow">
                        Case {c.number} · {c.difficulty} · ~{c.est_minutes} min
                      </p>
                      <StatusBadge status={c.status} />
                    </div>
                    <p className="mt-2 font-display text-2xl text-paper">{c.title}</p>
                    <p className="mt-2 line-clamp-2 max-w-2xl text-sm text-smoke-300">{c.teaser}</p>
                  </div>
                  <span className="hidden shrink-0 items-center gap-2 text-sm font-medium text-gold-400 sm:flex">
                    {c.status === "active" ? "Resume" : c.status === "closed" ? "Investigate again" : "Open file"}
                    <ArrowRight className="size-4 transition group-hover:translate-x-1" />
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <div className="mt-14 grid gap-8 md:grid-cols-2">
            <section>
              <h2 className="flex items-center gap-2 font-display text-2xl font-semibold text-paper">
                <Trophy className="size-5 text-gold-500" /> Closed investigations
              </h2>
              {history.length === 0 ? (
                <p className="panel mt-5 p-6 text-sm text-smoke-400">No cases closed yet.</p>
              ) : (
                <ul className="mt-5 space-y-3">
                  {history.map((h) => (
                    <li key={h.session_id}>
                      <Link
                        to={`/results/${h.session_id}`}
                        className="panel flex items-center gap-4 p-5 transition hover:border-gold-700"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block font-display text-xl text-paper">{h.case_title}</span>
                          <span className="block text-xs text-smoke-400">
                            {h.solved ? "Solved" : "Wrong suspect"} · {new Date(h.closed_at).toLocaleDateString()} · +
                            {h.xp_awarded} XP
                          </span>
                        </span>
                        <span className="font-display text-3xl text-gold-300 tabular-nums">
                          {h.total}
                          <span className="text-sm text-smoke-400">/100</span>
                        </span>
                        <ArrowRight className="size-4 text-smoke-400" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h2 className="flex items-center gap-2 font-display text-2xl font-semibold text-paper">
                <Award className="size-5 text-gold-500" /> Achievements
              </h2>
              {player && (
                <ul className="mt-5 grid gap-2 sm:grid-cols-2">
                  {player.achievements.map((a) => (
                    <li
                      key={a.code}
                      className={`panel flex items-start gap-3 p-4 ${a.unlocked_at ? "border-gold-700/60" : "opacity-60"}`}
                    >
                      {a.unlocked_at ? (
                        <BadgeCheck className="mt-0.5 size-5 shrink-0 text-gold-400" />
                      ) : (
                        <Lock className="mt-0.5 size-5 shrink-0 text-smoke-400" />
                      )}
                      <span>
                        <span className="block text-sm text-paper">{a.title}</span>
                        <span className="block text-xs text-smoke-400">{a.description}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: CaseListItem["status"] }) {
  const tone =
    status === "active"
      ? "border-gold-700 text-gold-400"
      : status === "closed"
        ? "border-ink-600 text-smoke-400"
        : "border-blood-500 text-blood-400";
  return (
    <span className={`rounded-sm border px-2 py-0.5 font-mono text-[10px] tracking-[0.15em] uppercase ${tone}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function ProfileCard({ player, onChange }: { player: Player; onChange: (p: Player) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(player.display_name);
  const [error, setError] = useState<string | null>(null);
  const { rank, xp } = player;
  const pct = rank.next_xp ? Math.min(100, ((xp - rank.xp_floor) / (rank.next_xp - rank.xp_floor)) * 100) : 100;

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      onChange(await api.rename(name.trim()));
      setEditing(false);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="panel mt-6 grid animate-rise gap-8 p-6 sm:p-8 md:grid-cols-[1fr_auto]">
      <div>
        {editing ? (
          <form onSubmit={save} className="flex items-center gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              aria-label="Detective name"
              className="min-w-0 flex-1 rounded-sm border border-gold-700 bg-ink-950 px-3 py-2 font-display text-3xl text-paper focus:outline-none"
            />
            <button type="submit" aria-label="Save name" className="p-2 text-gold-400 hover:text-gold-300">
              <Check className="size-5" />
            </button>
            <button
              type="button"
              aria-label="Cancel"
              onClick={() => {
                setEditing(false);
                setName(player.display_name);
              }}
              className="p-2 text-smoke-400 hover:text-paper"
            >
              <X className="size-5" />
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-3">
            <h1 className="font-display text-4xl font-semibold text-paper sm:text-5xl">{player.display_name}</h1>
            <button
              onClick={() => setEditing(true)}
              aria-label="Edit name"
              className="p-1 text-smoke-400 transition hover:text-gold-400"
            >
              <Pencil className="size-4" />
            </button>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-blood-400">{error}</p>}

        <p className="mt-3 font-mono text-xs tracking-[0.2em] text-gold-500 uppercase">{rank.name}</p>
        <div className="mt-4 max-w-md">
          <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
            <div className="h-full bg-gold-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-smoke-400">
            {xp} XP
            {rank.next_xp != null && ` · ${rank.next_xp - xp} to ${rank.next_name}`}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-4 self-center">
        <Stat icon={FolderOpen} label="In progress" value={player.cases_active} />
        <Stat icon={Trophy} label="Closed" value={player.cases_closed} />
      </dl>
    </section>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Trophy; label: string; value: number }) {
  return (
    <div className="min-w-28 rounded-sm border border-ink-700 bg-ink-950/50 p-4">
      <dt className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.2em] text-smoke-400 uppercase">
        <Icon className="size-3.5" />
        {label}
      </dt>
      <dd className="mt-2 font-display text-3xl text-paper">{value}</dd>
    </div>
  );
}
