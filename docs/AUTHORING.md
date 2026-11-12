# Writing a case

A case is a folder in `cases/` with two files. The engine contains no story, so a new folder is all a new
mystery needs. Everything is checked at startup, and a broken case refuses to load with a list of problems.

```
cases/case_002/
  case.json       facts: briefing, suspects, statements, evidence, contradictions, timeline, hints, solution
  dialogue.json   the interrogation script for each suspect
```

Validate while you write:
```bash
cd backend && .venv\Scripts\python -m scripts.validate_case
```
It prints errors with their location, or a summary like
`4 suspects · 10 evidence (6 initial, 10 reachable) · 5 contradictions (3 decisive)`. **Reachable** means the
validator has proven a player can unlock that item through talking and the board, using only conditions a
player can actually meet.

The schema, with comments on every field, is [`backend/app/schemas/case.py`](../backend/app/schemas/case.py).
Case 001 is the worked example.

---

## 1. Design the truth first

Write the real timeline before anything else (`timeline`, HH:MM, in order). Then decide:
- **Culprit, motive, method.** The method must be provable from evidence, not from a confession. Suspects never confess; the accusation is the player's job.
- **Each innocent's secret.** Give every innocent person something to lie about that isn't the crime. These are your red herrings, and each one should have an innocent explanation the player can uncover.
- **Decisive contradictions.** At least one must break the culprit's own statement.

## 2. `case.json`

| Section | Visible to the player? | Notes |
|---|---|---|
| `meta`, `briefing` | Yes | `briefing.narration` is spoken by `narrator.voice`. |
| `stt.keyterms`, `stt.topic` | No | Recognition hints for Prisma (≤200 terms). **Never include two near-identical terms** (e.g. `F-301` and `F-310`): Prisma will pick one for both. |
| `suspects[].statement`, `claims` | Yes | Each claim is one checkable sentence. Claims are what the player pins on the board. |
| `suspects[].voice` | No | Timbre `model`, `voice`, `language` (`en-IN`, `hi-en` Hinglish, …), `speed` 0.85–1.15. |
| `suspects[].truth`, `secrets` | No | Notes for you; never sent to the client. |
| `evidence[]` | When unlocked | `unlock.initial: true`, or `unlock.triggers` (any of the triggers below). `details` lines that start with `HH:MM ·` become one-click timeline suggestions. |
| `contradictions[]` | Explanation only once proven | `claim_id` + `evidence_ids` (any one of them proves it). `decisive` and `points` stay hidden until the results page. Points across all contradictions should total 25. |
| `hints[]` | One at a time, when asked | Ordered. The player gets the first hint whose `done_when` is not yet true. The last hint must have no `done_when`. |
| `solution` | Only after the accusation | `decisive_evidence` (+5 each, keep to 4), `supporting_evidence` (no penalty), `decisive_contradictions`, `innocents` (one explanation per innocent), `rubric` (ideas the explanation should mention, with keywords). |

### Unlock triggers (`evidence[].unlock.triggers`)
| Trigger | Fires when |
|---|---|
| `contradiction:C2` | the player proves C2 on the board |
| `reveal:riya.arrival_time` | a reply that `reveals` that topic is given |
| `confront:ramesh:E5` | the player shows E5 to Ramesh |
| `evidence:E7` | E7 is unlocked (use for chains: finding a book leads to its issue record) |

### Hint conditions (`hints[].done_when`, any-of)
`contradiction:C4` · `found:E6` · `revealed:kabir.whereabouts`

## 3. `dialogue.json`

```json
{
  "suspects": {
    "<suspect_id>": {
      "lines": { "greeting": "…", "story": "…", "suspicion": "…", "no_link": "…", "unknown": ["…", "…"] },
      "topics": [
        {
          "id": "arrival_time",
          "label": "Time of arrival",
          "keywords": ["arrive", "what time", "8:20", "late", "register"],
          "evidence": ["E1"],
          "replies": [
            { "id": "deny",  "text": "Eight-twenty. I told you." },
            { "id": "press", "when": ["asked:1"], "text": "Eight-twenty, maybe twenty-five…" },
            { "id": "admit", "when": ["presented:E1"], "reveals": ["arrival_time"], "text": "Fine. Eight-thirty-five…" }
          ]
        }
      ]
    }
  }
}
```

**How a question is answered**
1. **Showing evidence** routes to the *first* topic that lists that evidence. If no topic lists it, the suspect says the `no_link` line. Put each piece of evidence in the topic it should break.
2. **Otherwise the words are scored.** Each matched keyword phrase scores its word count. Plurals match automatically, and times like `8.16` are normalised to `8:16`. General questions ("hello", "what happened", "who did it") score at half weight, so a real topic always wins a tie.
3. **Follow-ups.** A short question ("Why?", "Are you sure?") with no match goes back to the last topic.
4. **Nothing matched:** the suspect rotates through the `unknown` lines.

**Which reply is given:** the *last* reply in the topic whose `when` conditions all hold. The first reply must have no conditions.

| Condition | True when |
|---|---|
| `presented:E4` / `presented:E7\|E8` | the player has shown that evidence to *this* suspect, now or earlier. Use for admissions that stay admitted. |
| `showing:E3` | the evidence is being shown on *this* question. Use for one-off reactions ("Why are you showing me this?"). It must be listed in the topic's `evidence`. |
| `found:E5` | the player has unlocked it |
| `revealed:riya.arrival_time` | that topic has slipped already (from any suspect) |
| `asked:2` | this topic was asked at least twice before (pressing) |

`reveals` on a reply fires `reveal:<suspect>.<topic>` (unlocking evidence) and counts toward the Questioning score.

**Rules of thumb**
- Pressing alone should never break a suspect on anything that matters; make admissions need proof.
- Write each reply to make sense when replayed later, because admissions stick.
- Keep replies under about 400 characters. Each one becomes a voice line.
- Add a routing test for natural phrasings (see `ROUTES` in `backend/tests/test_interrogation.py`).

## 4. Voice

Run `scripts.tts_audition` to compare voices for one line, then `scripts.pregen_audio` to render every line
once. Changing any text or voice setting creates a new cache entry; old files can be deleted safely.

## 5. Check it plays

1. `scripts.validate_case` passes.
2. Play it start to finish by typing, then by voice.
3. Add an API playthrough test like `test_perfect_run_through_the_api` (in `backend/tests/test_accusation.py`) that reaches 100. It catches unreachable admissions that the validator can't judge as *natural* to find.
