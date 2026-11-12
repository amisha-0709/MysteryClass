# Mystery Class: Plan of Record

> Everyone has a story. Not everyone is telling the truth.

Status: **Planning. Awaiting review.** No application code has been written yet.

---

## 0. Environment findings (inspected 2026-11-12)

| Item | Finding |
|---|---|
| `D:\MysteryClass` | Empty. Greenfield, not a git repo yet. |
| Python | 3.13.4 |
| Node / npm | 24.21.0 / 12.2.0 |
| ffmpeg | **Not installed.** Plan avoids needing it (browser encodes WAV). |
| Prior Gnani work | `D:\PakkaNote` has working Prisma STT and Timbre TTS calls, a WAV/PCM normaliser, browser-side WAV encoding and measured latencies. |
| Credentials | `D:\PakkaNote\.env` holds `GNANI_API_KEY` (value not read). It is not yet present in this project. |
| LLM credentials | None found. |

### Reusable from PakkaNote
- Auth header `X-API-Key-ID: $GNANI_API_KEY`. This is the same key for STT and TTS.
- STT: `POST https://api.vachana.ai/stt/v3`, multipart (`audio_file`, `language_code`, `format`, …).
- TTS: `POST https://api.vachana.ai/api/v1/tts/inference`, JSON (`text`, `voice`, `model`, `language`, `speed`, `audio_config`).
- WAV-vs-raw-PCM detection and re-wrapping (`web_app.py`, the function around line 125).
- In-browser WAV encoding of mic audio (`index.html`, around line 679). This means no ffmpeg is needed server-side.
- Measured on 2026-10-18: STT median of about 0.54 s, TTS median of about 1.27 s, 20/20 success rate.

### Verified against current docs (docs.gnani.ai)
**Prisma STT** ([docs](https://docs.gnani.ai/api/STT/speech-to-text.md))
- Models: `prisma-v2.5` (default) and `prisma-v3.0`.
- `format`: `verbatim` | `transcribe` (ITN) | `codemix` (v3.0) | `transliterate` (v3.0).
- `language_code`: `en-IN`, `hi-IN` and 8 other Indic codes. v3.0 also accepts `indic-auto` or a list such as `hi-IN,en-IN`.
- **Hinglish:** there is no dedicated code. `en-IN` "accepts English-Hindi mixed audio" and outputs Latin script. That is exactly what our text engine wants.
- v3.0 `keyterms` (≤200) and `topic`. **We use these to bias recognition toward "Mehta", "Kabir", "Riya", "register", "spare key" and similar terms.**
- Limits: **30 s maximum audio**. The model has a 5 s upstream timeout (returns 504). **429 if more than one request is active per account.**
- Formats: WAV, MP3, OGG, FLAC, AAC, M4A. Audio is resampled to 16 kHz mono server-side.
- Errors: `{success:false, error:{type,message}}` (400/500), `detail` shape (401/402/403/429), 504 gateway.

**Timbre TTS** ([docs](https://docs.gnani.ai/api/TTS/tts-inference.md), [voices](https://docs.gnani.ai/api/TTS/available-voices.md))
- Models: `timbre-v2.5` (42 voices, one language each) and `timbre-v3.0` (13 voices, all languages, inline tags such as `<pauses>`).
- `language` includes `en-IN`, `hi-IN` and `hi-en` (Hinglish).
- `speed` ranges from 0.85 to 1.15. `audio_config.container` can be `wav`, `mp3`, `ogg` or `raw`.
- The response is raw audio bytes. Errors return `{success:false, message, status_code}`.
- The maximum text length is **not documented**, so we chunk long narration by sentence (target ≤ 400 chars).

**Verified live (2026-11-13):** our key can use `prisma-v3.0`, `timbre-v2.5` and `timbre-v3.0`. Timbre accepts 24 kHz mono WAV and a 609-character text in one call (~3 s). Its WAV has placeholder sizes (`0xFFFFFFFF`), so we re-wrap the PCM. We still split texts over 700 characters by sentence, because the real limit is undocumented.
**STT hint lesson:** putting both `F-301` and `F-310` in `keyterms` made Prisma hear "F-301" as "F-310". Keyterms must not contain near-identical terms; `F-310` was removed.

---

## 1. Understanding of Mystery Class

A voice-first detective game for college students. The player is the detective. Each case is a fixed, authored mystery with one true solution. The player learns the truth only by:
- **listening** to statements, where details matter,
- **questioning** suspects aloud, using follow-ups and confronting them with evidence,
- **cross-checking** statements against evidence on a board,
- **arguing** a final accusation in their own words.

Suspects are deterministic witnesses, not improvisers. They know only what their character knows. They lie where the script says they lie. They crack only when the player presents the right contradiction. Gnani STT and TTS make the interrogation a spoken conversation. Typing is always available as an equal alternative.

The learning outcomes (listening, reasoning, evidence use and communication) come from *how the game is scored*, not from quizzes.

---

## 2. Technical architecture

```
┌──────────────────────── Browser (React + Vite + Tailwind) ────────────────────────┐
│ Pages: Landing · Dashboard · Briefing · Investigation · Interrogation ·            │
│        Evidence Board · Accusation · Resolution                                    │
│ useRecorder(): getUserMedia → PCM → 16 kHz mono WAV (≤30 s, auto-stop)             │
│ AudioPlayer: waveform, play/pause/replay, transcript sync                          │
│ API client (fetch) — never sees Gnani key or solution data                         │
└──────────────────────────────┬────────────────────────────────────────────────────┘
                               │ JSON + multipart (same-origin via Vite proxy → :8010)
┌──────────────────────────────▼──────────────── FastAPI (Python) ──────────────────┐
│ routers/   cases · sessions · interrogation · board · accusation · voice · player │
│ engine/                                                                            │
│   case_loader     loads + validates cases/<id>/case.json (pydantic schema)         │
│   public_view     strips solution/hidden fields before anything leaves server      │
│   unlocks         evidence/topic unlock rules (event → unlock)                     │
│   interrogation   intent matcher → suspect state machine → scripted response       │
│   (optional) llm  intent classification + paraphrase, constrained to fact list    │
│   contradictions  validates player-made links against authored contradiction set  │
│   scoring         rubric → score + 4 category scores + report                      │
│ voice/                                                                             │
│   gnani_client    one shared httpx client, global asyncio.Semaphore(1) (429 rule), │
│                   timeouts, retries w/ backoff on 429/503/504, typed errors        │
│   stt             Prisma call + keyterms per case                                  │
│   tts             Timbre call + sentence chunking + WAV normalise + disk cache     │
│ db/  SQLite via SQLModel                                                           │
└───────────────┬───────────────────────────────┬──────────────────────────────────┘
                │                               │
      backend/data/mystery.db          backend/audio_cache/<sha256>.wav
                                       (key = text+voice+model+lang+speed)
```

### Key design decisions
1. **Case as data.** Everything specific to a case lives in `cases/case_001/case.json`: story, suspects, statements, topics, lies, evidence, unlock rules, contradictions, solution and rubric. The engine is case-agnostic. A new case means a new folder.
2. **The solution never leaves the server** until the accusation is submitted. `public_view` is a whitelist serializer. Tests assert that no solution field appears in any pre-resolution response.
3. **The backend is the referee.** Unlocks, contradiction validation, hint counts and scoring all happen server-side. The client only renders.
4. **Deterministic interrogation core with an optional LLM layer.**
   - Core (always on, works offline). Each suspect has topics (`whereabouts`, `key`, `time_of_arrival`, …), each with keyword/phrase patterns and per-stance responses (`deny`, `deflect`, `admit`). A stance changes only when an authored trigger fires, such as "player presented E4" or "contradiction C2 confirmed". Follow-ups use the conversation's last topic. Unknown questions get an in-character "I don't know about that" from a per-suspect pool.
   - Optional LLM (if a key is provided). It does two things only: (a) classify a free-form question into one of the suspect's *allowed* topics, and (b) rephrase the authored response in the suspect's voice. It never adds facts. The authored response is the source of truth, and the output is validated against it (no new names, times or evidence IDs). If the LLM fails, the core works alone.
5. **Voice is cached aggressively.** All static lines (narration, initial statements and every authored response) are pre-generated by a script and stored on disk. At runtime TTS is called only for LLM-paraphrased lines, so most of play costs zero TTS calls.
6. **Gnani's one-active-request limit** is handled by a process-wide semaphore plus a queue. 429 triggers a short backoff and retry. The UI shows "Suspect is thinking…" or "Transcribing…" states.
7. **Graceful fallback.** If `GNANI_API_KEY` is missing or the API is down, the mic button shows "Voice unavailable — type your question" and text replies appear without audio. This is a clearly labelled dev fallback, not a mock that pretends to succeed.

### Data model (SQLite)
| Table | Purpose |
|---|---|
| `player` | id, display_name, xp, rank, created_at |
| `case_session` | id, player_id, case_id, stage, started_at, completed_at, hints_used |
| `unlocked_evidence` | session_id, evidence_id, unlocked_at, source |
| `suspect_state` | session_id, suspect_id, topic_id, stance |
| `interrogation_turn` | session_id, suspect_id, question_text, input_mode (voice/text), matched_topic, response_id, ts |
| `board_item` / `board_link` | player's pinned items and connections |
| `contradiction_found` | session_id, contradiction_id, found_at, attempts |
| `note` | session_id, text, ts |
| `accusation` | session_id, suspect_id, method_text, evidence_ids, contradiction_ids, input_mode |
| `result` | session_id, total, category scores, breakdown JSON |
| `achievement` | player_id, code, earned_at |

### API sketch
```
GET  /api/cases                         list (public)
POST /api/sessions {case_id}            start / resume
GET  /api/sessions/{id}                 public state: stage, unlocked evidence, suspects
POST /api/sessions/{id}/interrogate     {suspect_id, text, present_evidence_id?} → reply + audio_url + unlocks
POST /api/voice/stt                     multipart wav → {transcript}
GET  /api/voice/audio/{hash}.wav        cached audio
POST /api/sessions/{id}/board/link      {statement_id, evidence_id} → {is_contradiction, unlocks}
POST /api/sessions/{id}/notes
POST /api/sessions/{id}/hint
POST /api/sessions/{id}/accuse          → locks session, returns resolution + score
GET  /api/player/me                     dashboard stats
```

---

## 3. Proposed folder structure

```
MysteryClass/
├── .env.example                 GNANI_API_KEY=, ANTHROPIC_API_KEY= (optional)
├── .gitignore                   .env, audio_cache/, *.db, node_modules, .venv
├── README.md
├── docs/
│   ├── PLAN.md                  (this file)
│   └── cases/case_001_solution.md   designer's bible (spoilers)
├── cases/
│   └── case_001/
│       ├── case.json            single source of truth for the case
│       └── assets/              suspect portraits, evidence images
├── backend/
│   ├── pyproject.toml / requirements.txt
│   ├── app/
│   │   ├── main.py              FastAPI app, CORS, routers, static audio
│   │   ├── config.py            env settings (pydantic-settings)
│   │   ├── db.py, models.py     SQLModel tables
│   │   ├── schemas/             case schema + API DTOs
│   │   ├── routers/             cases, sessions, interrogation, board, accusation, voice, player
│   │   ├── engine/              case_loader, public_view, unlocks, interrogation, contradictions, scoring, llm
│   │   └── voice/               gnani_client, stt, tts, audio_utils (wav normalise from PakkaNote)
│   ├── scripts/
│   │   ├── validate_case.py     consistency checks (timeline, refs, solvability)
│   │   └── pregen_audio.py      batch TTS for all static lines
│   ├── audio_cache/
│   └── tests/                   engine, leak tests, scoring, voice client (mocked HTTP)
└── frontend/
    ├── package.json, vite.config.ts (proxy /api → :8010), tailwind config
    └── src/
        ├── main.tsx, App.tsx, router
        ├── api/                 typed client
        ├── hooks/               useRecorder, useAudio, useSession
        ├── components/          SuspectCard, AudioPlayer+Waveform, MicButton, EvidenceCard,
        │                        BoardCanvas, Timeline, NotesPanel, StageNav, Toasts
        ├── pages/               Landing, Dashboard, Briefing, Investigation,
        │                        Interrogation, EvidenceBoard, Accusation, Resolution
        └── styles/              noir theme tokens
```
I'm proposing TypeScript for the frontend because typed API contracts catch leaks and bugs early. Plain JS is fine if you prefer it.

---

## 4. Case 001: The Missing Examination Paper (complete solution, SPOILERS)

### Setting
- **Northbridge University, Raman Academic Block.**
  - Ground floor: entrance lobby, security cabin and register, staircase and lift (the *only* way to upper floors). The Exam Cell is in the west wing.
  - 1st floor: library, with an RFID gate that logs card IN/OUT.
  - 2nd floor: classrooms.
  - 3rd floor: faculty room (F-301), assignment submission tray outside it, and a washroom.
- The exam is Applied Chemistry Final, Hall B (ground floor), starting at 9:00 AM.
- The paper is a sealed brown envelope with 6 pages and an "EXAM CELL – CONFIDENTIAL" seal. It was kept in Prof. Mehta's **desk drawer** instead of the locked steel cabinet that protocol requires.

### Cast
| Suspect | Role | Personality / voice | Initial statement (from brief) | Truth |
|---|---|---|---|---|
| **Prof. Arvind Mehta** | Chemistry professor, paper-setter | Precise, proud, defensive about protocol | Locked F-301 at 8:15; nobody else had the key. | Locking at 8:15 is true. He **forgets or omits the spare key** in the security cabin, and hides that he left the paper in his desk drawer rather than the cabinet. |
| **Riya Sharma** | 3rd-year student, top of class, recently argued with Mehta about grades (red herring) | Confident, quick, a little sarcastic | Arrived 8:20 to submit an assignment; never entered the faculty room. | Never entered is **true**. She **lied about the time**: she arrived at 8:35, after the 8:30 deadline, and wants the submission counted. She saw a library book on the stair landing. |
| **Kabir Malhotra** | 2nd-year student on academic probation (failed midterm); volunteered with security during orientation week | Polite, nervous, over-explains | Studying in the library; did not visit the faculty floor. | **Culprit.** Left the library 8:16–8:33. |
| **Ramesh Yadav** | Security guard, 12 years' service | Gruff, loyal, Hinglish speaker, defensive about his job | Nobody went up to the faculty room after 8 AM; the register is accurate. | The register *is* accurate (visitors self-sign under the clock). But he **left his post 8:12–8:32 for tea** and can't know who went up. Later he noticed the spare key on the wrong hook and kept quiet. |

### True timeline (canonical, the engine treats this as fixed)
| Time | Event | Who knows / evidence |
|---|---|---|
| 7:50 | Mehta signs register and goes to F-301 with the sealed envelope. Puts it in his **desk drawer**. | Register (E1) |
| 8:03 | Kabir enters the block (students with ID don't sign), goes to the library. | — |
| 8:05 | Kabir's library card: **IN**. | Library gate log (E4) |
| 8:07 | Kabir issues *Organic Chemistry Vol. 2* (barcode NB-OC2-0417). | Library issue record (E8) |
| 8:12 | Ramesh leaves the cabin for the canteen. **Key board left unattended.** | Canteen slip (E6) |
| 8:14 | Canteen counter slip: "2 tea, 1 samosa – ₹40 – Security". | E6 |
| 8:15 | Mehta locks F-301 with his key and goes to the Exam Cell (west wing) for answer booklets. | Mehta (true) |
| 8:16 | Kabir: library **OUT**. | E4 |
| 8:18 | Kabir takes spare key **F-301** from the unattended key board in the security cabin. He knew the layout from orientation-week volunteering. | Key board (E5) |
| 8:22 | Kabir unlocks F-301, takes the envelope from the desk drawer, **re-locks the door**. | No forced entry (E2) |
| 8:23–8:29 | In the 3rd-floor washroom: tears the seal, photographs all 6 pages on his phone. Can't reseal it, panics, stuffs the envelope in the washroom bin. | Envelope (E3) |
| ~8:30 | Rushing down the stairs, drops his library book on the 2nd–3rd floor landing. | Book (E7) |
| 8:31 | Hangs the spare key back, **on hook F-310 instead of F-301**. | E5 |
| 8:32 | Ramesh returns to the cabin. | E6 (implied) |
| 8:33 | Kabir: library **IN**. | E4 |
| 8:35 | Riya signs the register: "Riya Sharma – 8:35 – Assignment submission". | E1 |
| 8:36 | Riya goes up. On the landing she sees a library book and moves it to the windowsill. | Riya (hidden) |
| 8:37 | Riya drops her assignment in the tray outside F-301. Door locked. She does not enter. | Tray (E9) |
| 8:39 | Riya leaves. | — |
| 8:40 | Mehta returns and unlocks F-301 (door was locked). | E2 |
| 8:45 | Mehta opens his drawer and finds the **paper missing**. Alarm raised. | Incident |
| 8:50 | During the search Ramesh notices the F-301 spare key on the F-310 hook. Says nothing. | E5 (hidden until asked) |
| 8:52 | Housekeeping finds the torn envelope (all 6 pages, seal broken) in the 3rd-floor washroom bin. | E3 |

### Evidence (9 items, tiered)
| ID | Evidence | Tier | Available | Points to |
|---|---|---|---|---|
| E1 | **Security register page.** Mehta 7:50; Riya 8:35; no other visitor entries 8:00–8:45 | 1 | Start | Riya's lie |
| E2 | **Door/lock report.** No forced entry; door found locked at 8:40; only Mehta's key and one spare exist | 1 | Start | A key was used |
| E3 | **Torn envelope.** Found in 3rd-floor washroom bin at 8:52; pages intact; seal torn; "the culprit wanted the *contents*, not the paper" | 1 | Start | Someone photographed it on the 3rd floor |
| E4 | **Library RFID gate log.** Kabir IN 8:05, OUT 8:16, IN 8:33 | 2 | Start (needs careful reading) | Kabir's lie |
| E5 | **Security cabin key board.** Inventory lists spare F-301; spare found on hook F-310 | 2 | Unlock: ask Mehta or Ramesh about other or spare keys | Spare key used |
| E6 | **Canteen counter slip** 8:14, "Security" | 2 | Unlock: ask Ramesh whether he left his post, OR after E5 found | Guard's lie; window of opportunity |
| E7 | **Library book** *Organic Chemistry Vol. 2*, found on the 2nd–3rd floor landing windowsill | 3 | Unlock: Riya admits the true time (C1 confirmed or confronted with E1) and is asked what she saw | Someone from the library was on the stairs |
| E8 | **Library issue record** NB-OC2-0417 → Kabir Malhotra, 8:07 | 3 | Unlock: with E7 | Kabir was on the faculty floor |
| E9 | **Assignment notice + tray.** "Submit by 8:30 AM sharp"; Riya's assignment on top | 1 | Start | Riya's motive to lie (red herring explained) |

Background (not evidence, visible on Kabir's profile): on academic probation after failing the Applied Chemistry midterm. This is motive.

### Contradictions (5 authored, 3 decisive)
| ID | Statement | vs Evidence | Meaning | Decisive? |
|---|---|---|---|---|
| C1 | Riya: "I arrived at 8:20." | E1 register 8:35 (+E9 deadline 8:30) | Riya lied about time to beat the deadline, not about the theft. Unlocks her real testimony (the book). | No (red herring, but needed to reach E7) |
| C2 | Kabir: "I was in the library the whole time." | E4 OUT 8:16 / IN 8:33 | Kabir was absent during the theft window. | **Yes** |
| C3 | Kabir: "I never went to the faculty floor." | E7 + E8 his book on the 2nd–3rd landing | Kabir was on the way to the 3rd floor. | **Yes** |
| C4 | Ramesh: "Nobody went up after 8; I was at my post." | E6 canteen slip 8:14 | The cabin was unattended 8:12–8:32. | **Yes** (opportunity) |
| C5 | Mehta: "Nobody else had access to the key." | E5 / E2 spare key exists, found on the wrong hook | The spare key was used. | Supporting |

### Solvability check
- **Who:** Kabir is the only person whose movements overlap the 8:16–8:33 window *and* who is placed near the 3rd floor (C2 + C3).
- **How:** spare key (C5/E5) taken while the guard was away (C4/E6), door re-locked (E2), envelope photographed in the washroom (E3).
- **Why not others:** Mehta was in the Exam Cell (Exam Cell staff confirm on request) and gains nothing. Riya arrived 8:35, after the key was already returned (8:31) and the door already re-locked. She is on the register. Ramesh was at the canteen (slip), and stealing would be pointless for him.
- **Red herrings:** Riya's lie and her grade dispute with Mehta; Ramesh's lie; Mehta's protocol breach. Each has an innocent explanation that the player can uncover.
- **Minimum path:** E4 alone is enough to suspect Kabir. The full proof needs C2 + C3, with C4 + C5 for the method.

### Suspect secrets & confession triggers (excerpt; full scripts in case.json)
- **Mehta** admits there is a spare in the security cabin when asked about other keys or confronted with E2. Admits the drawer when asked where exactly the paper was kept.
- **Ramesh** admits the tea break when confronted with E6, or after the player establishes E5 and presses him about the key. Then volunteers the wrong-hook observation.
- **Riya** admits 8:35 when confronted with E1, or when C1 is linked. Then: "Fine. I was late. But I saw something on the stairs: a library book, just lying there."
- **Kabir** stage 1: denies. After C2 he claims he "went to the canteen". If asked about Ramesh or the canteen: "I… didn't see him there." After C3, with E5 or C4 also found, he **breaks**: he confesses to photographing the paper because of the probation, and says he deleted the photos.

### Final accusation rubric (concepts for "How?")
Spare key from security cabin · guard away / unattended cabin · left library 8:16–8:33 · re-locked door · photographed in washroom · dumped envelope · dropped library book.

---

## 5. Gnani integration plan

| Use | API | Settings (initial; tune in M3/M4) |
|---|---|---|
| Interrogation questions | Prisma STT | `prisma-v3.0` if our key allows it, `format=transcribe`, `language_code=en-IN` (handles Hinglish → Latin script), `keyterms` = suspect names, places, objects, times from case.json, `topic`="university exam theft investigation". Fallback: `prisma-v2.5` + `bias_list`. |
| Final verbal accusation | Prisma STT | Same, but the recorder chains ≤30 s segments (API limit), and the user can review and edit the text before submitting. |
| Narrator, statements, responses, announcements | Timbre TTS | `timbre-v2.5`, `audio_config` = 24 kHz mono WAV (smaller than 48 kHz; quality checked in M4). |

**Voice casting (timbre-v2.5, to audition in M4):**
- Narrator: Kaveri (en-IN, F, professional). Alternative: Hemraj (authoritative).
- Prof. Mehta: Pranav (en-IN, M). Alternative: Deepak (hi-IN, professional).
- Riya: Poorvi (`hi-en` Hinglish, F, conversational).
- Kabir: Shlok (en-IN, M, conversational). Speed 1.1 for nervousness.
- Ramesh: Omkar (hi-IN, M, authoritative), with `language=hi-en` for Hinglish lines.
- If `timbre-v3.0` is available on our key, its 13 multilingual voices may give a better cast. We'll A/B test it.

**Engineering rules**
- The key is read from `backend/.env` via pydantic-settings. It never reaches the frontend or logs.
- One `httpx.AsyncClient`. A global `Semaphore(1)` because Gnani allows one active request per account. STT timeout 15 s, TTS 30 s.
- Retries: 429/503/504 → up to 2 retries with backoff of 0.5 s then 1.5 s. 400 → surface a clear message ("Recording too short", "Recording over 30 s").
- Typed error → UI states: *recording / transcribing / thinking / speaking / failed (retry · type instead)*.
- TTS cache: `sha256(model|voice|lang|speed|text)` → `audio_cache/*.wav`. `pregen_audio.py` builds all static lines once.
- Browser: mic captured at native rate, downsampled to 16 kHz mono 16-bit WAV in JS (PakkaNote approach), with a hard stop at 29 s. Silence or empty transcripts are handled.

---

## 6. Milestones (stop for review after each)

| # | Milestone | Deliverable / acceptance |
|---|---|---|
| 1 | Frontend + landing | Vite/React/TS/Tailwind/Lucide scaffold, noir design tokens, Landing page, routing shells for all 8 pages, FastAPI skeleton with `/api/health`, Vite proxy. **Run:** `npm run dev` + `uvicorn`. |
| 2 | Case data, briefing, suspects | Case JSON schema + `case_001/case.json` + `validate_case.py`; case loader + public view + leak test; Dashboard (basic player), Briefing, suspect cards with transcripts. |
| 3 | Recording + Prisma STT | `useRecorder`, MicButton with level meter, `/api/voice/stt`, Gnani client (semaphore, retries, errors), keyterms; tests with PakkaNote sample audio. |
| 4 | Timbre TTS + audio | TTS service, cache, `pregen_audio.py`, AudioPlayer with waveform/replay/transcript, narrator intro, voice casting pass. |
| 5 | Interrogation engine | Topic matcher, stance state machine, "present evidence", unlock rules, conversation history, voice round-trip. **Done:** script lives in `cases/<case>/dialogue.json` (topics → keywords, linked evidence, ordered replies with `presented:/showing:/found:/revealed:/asked:` conditions). Suspects never confess: Kabir breaks down without admitting, so the culprit is confirmed only at the accusation. |
| 6 | Evidence board + contradictions | Board canvas (drag, connect), timeline builder, statement-vs-evidence linking validated server-side, notes, hints. **Done:** tap or drag to link a claim to evidence; the server answers only yes/no (never "close", never decisive/points). Wrong links: first 5 free, then −1 each (max −5), repeats free. 8 progressive hints in `case.json` (`done_when` conditions), −3 each, max 5, repeats of an unchanged hint free. Player timeline is their own notes (not graded against the truth). |
| 7 | Accusation + scoring + resolution | Voice/text accusation, rubric scoring, 4 categories, resolution reveal (timeline replay, found vs missed), XP/rank/achievements. **Done:** scoring is pure (`engine/scoring.py`) and frozen into `CaseResult` at accusation time. Added `solution.supporting_evidence` so only red herrings cost −2. Evidence proving the same decisive contradiction counts once (E7 ≡ E8). Explanation is halved for a wrong culprit. XP = score (×2 if solved); replays award only the improvement over the best previous run. Results live at `/results/:sessionId`; the narrator's solution clip is served only for closed sessions. |
| 8 | Testing + polish | Full playthrough tests, leak tests, error-path tests (no key, 429, timeout), animations, responsive layout, README. **Done:** 146 backend tests + 10 frontend (vitest), ruff lint, TTS error mapping fixed (502 not 422, transcript-oriented messages), full-game leak sweep, route error page, page titles, mobile/a11y sweep of every page, README rewrite, `docs/AUTHORING.md`. |

### Scoring (100 pts, transparent and shown in report)
| Component | Pts | Rule |
|---|---|---|
| Culprit | 25 | Correct = 25. *Only 10* if no supporting evidence is selected (guess penalty). |
| Evidence selection | 20 | E4, E5, E6, E7/E8 relevant (+5 each); irrelevant picks −2 each, floor 0. |
| Contradictions found | 25 | C2 8, C3 8, C4 5, C5 4 (C1 recognised but 0 pts: it's the red herring). Wrong link attempts beyond 5: −1 each, max −5. |
| Explanation | 15 | Rubric concepts covered (key, guard away, library exit, washroom photo, re-lock), 3 pts each, max 15. |
| Questioning | 15 | Distinct relevant topics opened + successful confrontations; repeated or irrelevant questions don't count. |
| Hints | −3 each | Max −15. |

Categories: **Listening** (statement details used in contradictions, transcript-vs-evidence accuracy), **Critical Thinking** (contradictions, red herring cleared), **Evidence Analysis** (evidence selection, timeline), **Communication** (explanation coverage, confrontations). These are gameplay metrics only, with no claims about pronunciation or intelligence.

---

## 7. Open decisions for review
1. **LLM layer:** ~~optional Claude intent/paraphrase layer?~~ **Decided 2026-11-13: deterministic only for the MVP.** The engine is pure (`engine/interrogation.py`), so a classifier could be added later in front of `route()` without touching the script.
2. **Credentials:** copy `GNANI_API_KEY` from `D:\PakkaNote\.env` into `D:\MysteryClass\backend\.env`?
3. **Frontend language:** TypeScript (recommended) or JavaScript?
4. **Player identity:** a local single profile (no auth) for the MVP?
