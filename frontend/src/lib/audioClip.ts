// Loads a spoken clip from the server once, works out its waveform, and makes sure only one clip
// plays at a time across the whole app.

import { ApiError } from "../api/client";

export interface LoadedClip {
  url: string; // object URL for an <audio> element
  duration: number; // seconds
  peaks: number[]; // 0..1, one per bar
}

const cache = new Map<string, Promise<LoadedClip>>();

/** Fetch a clip once per page load. A failed load is forgotten so the player can retry. */
export function loadClip(src: string, bars: number): Promise<LoadedClip> {
  const key = `${src}#${bars}`;
  let p = cache.get(key);
  if (!p) {
    p = fetchClip(src, bars);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

async function fetchClip(src: string, bars: number): Promise<LoadedClip> {
  let res: Response;
  try {
    res = await fetch(src);
  } catch {
    throw new ApiError(0, "Can't reach the case server.");
  }
  if (!res.ok) {
    let detail = "This recording isn't available right now. Read the transcript instead.";
    let code: string | undefined;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
      code = body.code;
    } catch {
      /* non-JSON */
    }
    throw new ApiError(res.status, detail, code);
  }
  const buf = await res.arrayBuffer();
  const { duration, peaks } = analyseWav(buf, bars);
  return { url: URL.createObjectURL(new Blob([buf], { type: "audio/wav" })), duration, peaks };
}

/** Our server always sends 16-bit PCM WAV, so the waveform comes straight from the samples (no AudioContext). */
export function analyseWav(buf: ArrayBuffer, bars: number): { duration: number; peaks: number[] } {
  const view = new DataView(buf);
  let pos = 12;
  let rate = 24000;
  let channels = 1;
  let dataStart = 44;
  let dataLen = buf.byteLength - 44;
  while (pos + 8 <= buf.byteLength) {
    const id = String.fromCharCode(...new Uint8Array(buf, pos, 4));
    const size = view.getUint32(pos + 4, true);
    if (id === "fmt ") {
      channels = view.getUint16(pos + 10, true);
      rate = view.getUint32(pos + 12, true);
    } else if (id === "data") {
      dataStart = pos + 8;
      dataLen = Math.min(size, buf.byteLength - dataStart);
      break;
    }
    pos += 8 + size + (size & 1);
  }
  const samples = new Int16Array(buf, dataStart, Math.floor(dataLen / 2));
  const frames = Math.floor(samples.length / channels);
  const per = Math.max(1, Math.floor(frames / bars));
  const raw: number[] = [];
  for (let b = 0; b < bars; b++) {
    let sum = 0;
    const start = b * per * channels;
    const end = Math.min(samples.length, start + per * channels);
    for (let i = start; i < end; i += channels) sum += samples[i] * samples[i];
    raw.push(Math.sqrt(sum / Math.max(1, (end - start) / channels)));
  }
  const max = Math.max(...raw, 1);
  return { duration: frames / rate, peaks: raw.map((v) => Math.max(0.06, Math.pow(v / max, 0.7))) };
}

// ── one clip at a time ─────────────────────────────────────────────────
let playing: HTMLAudioElement | null = null;

export function claimPlayback(el: HTMLAudioElement) {
  if (playing && playing !== el) playing.pause();
  playing = el;
}

export function releasePlayback(el: HTMLAudioElement) {
  if (playing === el) playing = null;
}
