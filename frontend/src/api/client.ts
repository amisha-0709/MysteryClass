// Typed API client. All requests go through the Vite proxy to FastAPI.
// The frontend never holds API keys or solution data.

export interface CaseSummary {
  id: string;
  number: string;
  title: string;
  teaser: string;
  location: string;
  incident_time: string;
  difficulty: string;
  suspect_count: number;
  est_minutes: number;
  order: number;
}

export interface CaseListItem extends CaseSummary {
  status: "new" | "active" | "closed";
  session_id: string | null;
}

export interface Briefing {
  incident: string;
  location: string;
  date: string;
  time_of_incident: string;
  objective: string;
  situation: string[];
  narration: string;
}

export type AvatarStyle = "glasses" | "long_hair" | "short_hair" | "cap";

export interface Suspect {
  id: string;
  name: string;
  role: string;
  age: number;
  avatar: { initials: string; accent: string; style: AvatarStyle };
  personality: string;
  background: string;
  statement: string;
  claims: { id: string; text: string }[];
}

export type EvidenceKind = "document" | "log" | "object" | "record" | "report" | "receipt";

export interface Evidence {
  id: string;
  title: string;
  kind: EvidenceKind;
  summary: string;
  details: string[];
  found_at: string;
  unlocked_at: string;
  source: string;
}

export interface Note {
  id: number;
  text: string;
  created_at: string;
}

export interface FoundContradiction {
  id: string;
  claim_id: string;
  evidence_id: string;
  explanation: string;
  found_at: string;
}

export interface TimelineEntry {
  id: number;
  time: string;
  text: string;
  evidence_id: string | null;
}

export interface BoardState {
  found: FoundContradiction[];
  wrong_attempts: number;
  tried: [string, string][];
  hints: string[];
  my_timeline: TimelineEntry[];
  rules: { free_wrong_links: number; wrong_link_cap: number; hint_cost: number; hint_limit: number };
}

export interface LinkResult {
  result: "contradiction" | "no_contradiction" | "already_found" | "already_tried";
  contradiction: FoundContradiction | null;
  new_evidence: Evidence[];
  board: BoardState;
}

export interface HintResult {
  hint: string | null;
  charged: boolean;
  board: BoardState;
}

export interface SessionState {
  id: string;
  case: CaseSummary;
  briefing: Briefing;
  suspects: Suspect[];
  evidence: Evidence[];
  notes: Note[];
  progress: {
    briefing_done: boolean;
    status: "active" | "closed";
    evidence_found: number;
    evidence_total: number;
  };
  board: BoardState;
}

export interface Achievement {
  code: string;
  title: string;
  description: string;
  unlocked_at: string | null;
}

export interface HistoryItem {
  session_id: string;
  case_id: string;
  case_title: string;
  case_number: string;
  solved: boolean;
  total: number;
  xp_awarded: number;
  closed_at: string;
}

export interface ScoreComponent {
  id: string;
  label: string;
  points: number;
  max: number;
  notes: string[];
}

export interface Resolution {
  case: CaseSummary;
  correct: boolean;
  culprit_id: string;
  culprit_name: string;
  summary: string;
  motive: string;
  method: string[];
  innocents: { suspect_id: string; name: string; explanation: string }[];
  contradictions: {
    id: string;
    suspect_name: string;
    claim: string;
    evidence: string[];
    explanation: string;
    decisive: boolean;
    points: number;
    found: boolean;
  }[];
  timeline: { time: string; text: string; evidence_ids: string[]; you_found: boolean }[];
  accusation: {
    suspect_id: string;
    suspect_name: string;
    explanation: string;
    mode: string;
    evidence: string[];
    contradiction: string | null;
  };
  score: {
    total: number;
    solved: boolean;
    components: ScoreComponent[];
    categories: { id: string; label: string; percent: number; description: string }[];
  };
  xp_earned: number;
  xp_awarded: number;
  rank_before: string;
  rank_after: string;
  new_achievements: Achievement[];
  clip_id: string;
}

export interface Player {
  id: number;
  display_name: string;
  xp: number;
  rank: { name: string; xp_floor: number; next_name: string | null; next_xp: number | null };
  cases_closed: number;
  cases_active: number;
  achievements: Achievement[];
}

export interface Health {
  status: string;
  version: string;
  integrations: { gnani: boolean; llm: boolean };
}

export interface VoiceStatus {
  stt: boolean;
  tts: boolean;
  stt_model: string;
  max_seconds: number;
}

export interface Transcription {
  transcript: string;
  empty: boolean;
  model: string;
  latency_ms: number;
  truncated: boolean;
}

export interface Turn {
  id: number;
  suspect_id: string;
  question: string;
  mode: "text" | "voice";
  evidence_id: string | null;
  evidence_title: string | null;
  reply: string;
  clip_id: string;
  revealed: boolean;
  created_at: string;
}

export interface AskResult {
  turn: Turn;
  new_evidence: Evidence[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      // JSON bodies are strings; FormData sets its own multipart boundary.
      headers: typeof init?.body === "string" ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
    });
  } catch {
    throw new ApiError(0, "Can't reach the case server. Is the backend running?");
  }
  if (!res.ok) {
    let detail = res.statusText;
    let code: string | undefined;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail)) detail = "That input wasn't accepted.";
      if (typeof body.code === "string") code = body.code;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail, code);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const json = (body: unknown) => JSON.stringify(body);

// Share one in-flight start per case so double-mounted effects don't fire two requests.
const pendingStarts = new Map<string, Promise<SessionState>>();
function startSession(case_id: string): Promise<SessionState> {
  let p = pendingStarts.get(case_id);
  if (!p) {
    p = request<SessionState>("/sessions", { method: "POST", body: json({ case_id }) }).finally(() =>
      pendingStarts.delete(case_id),
    );
    pendingStarts.set(case_id, p);
  }
  return p;
}

export const api = {
  health: () => request<Health>("/health"),
  cases: () => request<CaseListItem[]>("/cases"),
  me: () => request<Player>("/player/me"),
  rename: (display_name: string) =>
    request<Player>("/player/me", { method: "PATCH", body: json({ display_name }) }),
  startSession,
  session: (id: string) => request<SessionState>(`/sessions/${id}`),
  completeBriefing: (id: string) =>
    request<SessionState>(`/sessions/${id}/briefing-complete`, { method: "POST" }),
  addNote: (id: string, text: string) =>
    request<Note>(`/sessions/${id}/notes`, { method: "POST", body: json({ text }) }),
  deleteNote: (id: string, noteId: number) =>
    request<void>(`/sessions/${id}/notes/${noteId}`, { method: "DELETE" }),
  turns: (id: string, suspectId?: string) =>
    request<Turn[]>(`/sessions/${id}/turns${suspectId ? `?suspect_id=${encodeURIComponent(suspectId)}` : ""}`),
  ask: (id: string, suspectId: string, body: { question: string; mode: "text" | "voice"; evidence_id?: string }) =>
    request<AskResult>(`/sessions/${id}/suspects/${suspectId}/ask`, { method: "POST", body: json(body) }),
  testLink: (id: string, claim_id: string, evidence_id: string) =>
    request<LinkResult>(`/sessions/${id}/board/links`, { method: "POST", body: json({ claim_id, evidence_id }) }),
  hint: (id: string) => request<HintResult>(`/sessions/${id}/board/hint`, { method: "POST" }),
  addTimeline: (id: string, entry: { time: string; text: string; evidence_id?: string }) =>
    request<TimelineEntry>(`/sessions/${id}/board/timeline`, { method: "POST", body: json(entry) }),
  deleteTimeline: (id: string, entryId: number) =>
    request<void>(`/sessions/${id}/board/timeline/${entryId}`, { method: "DELETE" }),
  accuse: (
    id: string,
    body: { suspect_id: string; explanation: string; mode: "text" | "voice"; evidence_ids: string[]; contradiction_id?: string },
  ) => request<Resolution>(`/sessions/${id}/accuse`, { method: "POST", body: json(body) }),
  resolution: (id: string) => request<Resolution>(`/sessions/${id}/resolution`),
  history: () => request<HistoryItem[]>("/player/history"),
  /** URL of a spoken line (narration, statement.<suspect>). Generated server-side on first play, then cached. */
  clipUrl: (sessionId: string, clipId: string) =>
    `/api/voice/sessions/${encodeURIComponent(sessionId)}/clips/${encodeURIComponent(clipId)}`,
  voiceStatus: () => request<VoiceStatus>("/voice/status"),
  transcribe: (audio: Blob, opts: { sessionId?: string; purpose?: "question" | "accusation" | "check" } = {}) => {
    const form = new FormData();
    form.append("audio", audio, "recording.wav");
    if (opts.sessionId) form.append("session_id", opts.sessionId);
    form.append("purpose", opts.purpose ?? "question");
    return request<Transcription>("/voice/stt", { method: "POST", body: form });
  },
};
