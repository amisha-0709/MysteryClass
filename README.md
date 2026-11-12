# Mystery Class

> Everyone has a story. Not everyone is telling the truth.

A voice-powered detective game for college students. You listen to statements, question suspects out loud
(or by typing), pin lies against evidence, and make a final accusation that is scored on your reasoning.

- **Frontend:** React 19, Vite 8, Tailwind 4, TypeScript, Lucide icons
- **Backend:** Python FastAPI, SQLite (SQLModel)
- **Voice:** Gnani Prisma v3.0 (speech-to-text) and Gnani Timbre (text-to-speech)
- **Cases:** structured JSON in [`cases/`](cases). The engine is case-agnostic.

> [docs/PLAN.md](docs/PLAN.md) and `cases/*/case.json` contain the full solution. Don't open them if you want to play.

---

## Quick start (Windows)

You need Python 3.12+ and Node 20.19+ (or 22.12+).

**1. Backend** (http://localhost:8010)
```bash
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
copy ..\.env.example .env
```
Put your Gnani key in `backend\.env` (see [Configuration](#configuration)), then:
```bash
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8010
```

**2. Frontend** (http://localhost:5173, forwards `/api` to the backend)
```bash
cd frontend
npm install
npm run dev
```

**3. Play:** open http://localhost:5173 → *Start investigating*. Allow microphone access when asked, or just type.

## Configuration

Settings are read from `backend/.env`, which git ignores. Keys are only ever used on the server and are
never sent to the browser.

| Variable | Needed | What it does |
|---|---|---|
| `GNANI_API_KEY` | For voice | Gnani Vachana key, used for both speech-to-text and voices. Without it the game still works fully by typing and reading; the mic shows "Voice unavailable" and any voice line already in the cache still plays. |
| `CORS_ORIGINS` | No | Allowed browser origins. Default `http://localhost:5173`. |
| `DATABASE_URL` | No | Defaults to SQLite at `backend/data/mystery.db`. |
| `ANTHROPIC_API_KEY` | No | Unused. The interrogation engine is deterministic by design. |

`GET /api/health` reports which integrations are configured (true/false only).

## How a case plays

| Stage | What you do |
|---|---|
| **Briefing** | Read (or listen to) the incident, the facts and the people involved. |
| **Investigate** | Listen to each suspect's statement in their own voice and study the evidence locker. Keep notes. |
| **Interrogate** | Ask in your own words by voice or keyboard. Press them, follow up, and use 📎 to show evidence. Suspects only admit things when shown proof. New evidence can turn up. |
| **Evidence board** | Pin a statement against a record that contradicts it. The server confirms real contradictions; wrong guesses cost points after the first five. Hints cost points. Build your own timeline. |
| **Accuse** | Name the culprit, explain how it was done (dictate or type), cite your evidence. This closes the case. |
| **Results** | The truth, every lie in the case (found or missed), a minute-by-minute timeline and a transparent score. |

**Scoring (100):** Culprit 25 · Evidence cited 20 · Contradictions proven 25 · Explanation 15 · Questioning 15 · Hints −3 each.
The full rules are shown on the Accusation page before you commit, and the results page explains every point.
XP is the score (doubled if solved). Replaying a case only adds XP for beating your best result.

## Voice and cost

- **Speech-to-text:** the browser records up to 29 s, converts it to a 16 kHz WAV and sends it to the backend, which forwards it to Prisma v3.0. Names and places from the case are sent as recognition hints. Silent or very short clips are rejected before any paid call. Gnani allows one request at a time per account, so calls are queued, and busy or timeout errors are retried twice.
- **Voices:** every spoken line is authored in the case files and rendered by Timbre on first play, then cached forever in `backend/audio_cache/`, keyed by a hash of the voice settings and text. The browser can only request a line by ID, never send its own text, and interrogation replies are only served once that player has heard them.
- **Pre-render everything** so play makes no voice calls at all (about 90 lines for Case 001; lines already cached are skipped, and `--dry-run` shows the count first):
  ```bash
  cd backend && .venv\Scripts\python -m scripts.pregen_audio --dry-run
  cd backend && .venv\Scripts\python -m scripts.pregen_audio
  ```
- **Recast a voice:** compare candidates, then edit the `voice` block in `case.json` and pre-render again:
  ```bash
  cd backend && .venv\Scripts\python -m scripts.tts_audition statement.kabir Shlok Devansh@timbre-v3.0
  ```
- **Check speech-to-text on a file** (one paid call per file):
  ```bash
  cd backend && .venv\Scripts\python -m scripts.stt_smoke path\to\audio.wav
  ```

## Testing

```bash
cd backend && .venv\Scripts\python -m pytest -q
cd backend && .venv\Scripts\python -m ruff check .
cd backend && .venv\Scripts\python -m scripts.validate_case
cd frontend && npm test
cd frontend && npm run build
```

- **Backend (pytest, 146 tests, no network):** Gnani is replaced by a scripted fake transport, so tests never spend credits. They cover:
  - the case validator, including that every clue can be reached;
  - interrogation routing and how suspects change their answers;
  - board rules, hints and scoring, plus a perfect 100-point game played through the API alone;
  - voice error paths: no key, busy, timeout, network failure and junk audio;
  - malformed input and closed-case guards;
  - leak tests that play part of a game and assert that no hidden text (solution, unheard replies, unproven explanations, hints not yet given) appears in any response before the accusation.
- **Frontend (vitest):** the in-browser WAV encoder, downsampler and waveform analyser.
- **Case validation:** checks references, timeline order, the trigger and condition grammar, and runs a reachability fixpoint over evidence and dialogue to prove the case is solvable.

## Project layout

```
cases/case_001/       case.json (facts, evidence, solution, hints) + dialogue.json (interrogation script)
backend/app/
  engine/             case loading + validation, interrogation, board, scoring, achievements, public view
  routers/            cases, player, sessions, interrogation, board, accusation, voice
  voice/              Gnani client, Prisma STT, Timbre TTS + cache, clip catalogue, audio checks
backend/scripts/      validate_case, pregen_audio, tts_audition, stt_smoke
backend/tests/
frontend/src/
  pages/              Landing, Dashboard, Briefing, Investigation, Interrogation, EvidenceBoard, Accusation, Results
  components/ hooks/ lib/ api/
docs/                 PLAN.md (design + spoilers), AUTHORING.md (writing a new case)
```

Writing a new case: see [docs/AUTHORING.md](docs/AUTHORING.md).

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Can't reach the case server" | The backend isn't running on port 8010. Start it (Quick start, step 1). |
| Mic button greyed out, "Voice unavailable" | `GNANI_API_KEY` is missing in `backend\.env`, or the backend hasn't been restarted since you added it. Typing works regardless. |
| "Microphone access was blocked" | Allow the mic for `localhost` in the browser's site settings and try again. |
| "The voice service is busy" | Gnani allows one request at a time per account; another app may be using the key. Wait a moment. |
| A voice line won't play | The transcript is always shown next to it. Press Retry; if Gnani is out of credits, pre-render while credits are available. |
| Errors after pulling new code | Database tables are created automatically, but changed columns are not migrated. Stop the backend and delete `backend\data\mystery.db` (this resets progress). |
| Start over completely | Stop the backend and delete `backend\data\mystery.db`. Cached audio in `backend\audio_cache\` can stay. |

## Status

All eight milestones are complete. The game works fully by typing, without voice.
