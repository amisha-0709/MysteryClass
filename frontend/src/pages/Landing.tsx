import { ArrowRight, Gavel, Headphones, Mic, Waypoints } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { FeaturedCase } from "../components/FeaturedCase";
import { Logo } from "../components/Logo";
import { Waveform } from "../components/Waveform";
import { useApi } from "../hooks/useApi";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

const STEPS = [
  {
    icon: Headphones,
    title: "Listen",
    body: "Every suspect gives a recorded statement. Replay it. The details matter: a time, a room, a word they chose not to say.",
  },
  {
    icon: Mic,
    title: "Interrogate",
    body: "Pick a suspect, press the mic and ask. They answer in their own voice, and they stick to their story until you can prove otherwise.",
  },
  {
    icon: Waypoints,
    title: "Connect",
    body: "Pin statements against evidence on the board. When a claim and a record can't both be true, you've found a contradiction.",
  },
  {
    icon: Gavel,
    title: "Accuse",
    body: "Name the culprit, explain how it happened and cite your evidence. Lucky guesses score low. Reasoning scores high.",
  },
];

export default function Landing() {
  const cases = useApi(api.cases);
  useDocumentTitle("Everyone has a story");

  return (
    <div className="atmosphere relative min-h-dvh overflow-x-hidden">
      <div className="relative z-10">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6 sm:px-8">
          <Logo />
          <nav className="flex items-center gap-6 text-sm">
            <a href="#how" className="hidden text-smoke-300 transition hover:text-paper sm:inline">
              How it works
            </a>
            <Link to="/dashboard" className="text-smoke-300 transition hover:text-paper">
              Detective HQ
            </Link>
          </nav>
        </header>

        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pt-16 pb-20 sm:px-8 sm:pt-28 sm:pb-28">
          <p className="eyebrow animate-rise">A voice-powered investigation game</p>
          <h1
            className="mt-6 animate-rise font-display text-6xl leading-[0.95] font-semibold text-paper sm:text-8xl"
            style={{ animationDelay: "80ms" }}
          >
            Mystery
            <br />
            <span className="animate-flicker text-gold-500">Class</span>
          </h1>
          <p
            className="mt-8 max-w-lg animate-rise font-display text-2xl text-smoke-200 italic sm:text-3xl"
            style={{ animationDelay: "160ms" }}
          >
            Everyone has a story. Not everyone is telling the truth.
          </p>

          <div className="mt-10 flex animate-rise flex-wrap gap-4" style={{ animationDelay: "240ms" }}>
            <Link to="/dashboard" className="btn-primary">
              Start investigating
              <ArrowRight className="size-4" />
            </Link>
            <a href="#case" className="btn-ghost">
              View the open case
            </a>
          </div>

          <div
            className="mt-16 flex max-w-md animate-rise items-center gap-4 text-smoke-400"
            style={{ animationDelay: "320ms" }}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full border border-ink-600">
              <Mic className="size-4 text-gold-500" />
            </span>
            <Waveform className="flex-1" />
          </div>
        </section>

        {/* Featured case */}
        <section id="case" className="mx-auto max-w-6xl scroll-mt-8 px-4 pb-24 sm:px-8">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Featured case</p>
              <h2 className="mt-2 font-display text-3xl font-semibold text-paper">On your desk</h2>
            </div>
          </div>
          <FeaturedCase state={cases} />
        </section>

        {/* How it works */}
        <section id="how" className="border-t border-ink-800 bg-ink-900/40">
          <div className="mx-auto max-w-6xl scroll-mt-8 px-4 py-24 sm:px-8">
            <p className="eyebrow">How an investigation works</p>
            <h2 className="mt-2 max-w-2xl font-display text-4xl font-semibold text-paper">
              No multiple choice. Just you, the suspects and the evidence.
            </h2>

            <ol className="mt-14 grid gap-px overflow-hidden rounded-sm border border-ink-700 bg-ink-700 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(({ icon: Icon, title, body }, i) => (
                <li key={title} className="bg-ink-900 p-7">
                  <div className="flex items-center justify-between">
                    <Icon className="size-5 text-gold-500" />
                    <span className="font-mono text-xs text-smoke-400">0{i + 1}</span>
                  </div>
                  <h3 className="mt-6 font-display text-2xl font-semibold text-paper">{title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-smoke-300">{body}</p>
                </li>
              ))}
            </ol>

            <p className="mt-10 max-w-2xl text-sm leading-relaxed text-smoke-400">
              Built to sharpen listening, critical thinking, evidence analysis and verbal reasoning.
              Prefer typing? Every question and accusation can be typed instead of spoken.
            </p>
          </div>
        </section>

        <footer className="border-t border-ink-800">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-xs text-smoke-400 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <Logo />
            <p>All cases, people and institutions are fictional.</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
