import { describe, expect, it } from "vitest";
import { analyseWav } from "./audioClip";
import { concatChunks, downsample, encodeWav, peak, TARGET_RATE } from "./wav";

const sine = (n: number, rate: number, freq = 440, amp = 0.5) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate));

describe("downsample", () => {
  it("keeps duration when going 48 kHz → 16 kHz", () => {
    const out = downsample(sine(48000, 48000), 48000);
    expect(out.length).toBe(16000);
  });

  it("averages each window (box filter)", () => {
    const out = downsample(Float32Array.from([1, 2, 3, 4, 5, 6]), 48000, 16000);
    expect(Array.from(out)).toEqual([2, 5]);
  });

  it("handles non-integer ratios like 44.1 kHz", () => {
    expect(downsample(sine(44100, 44100), 44100).length).toBe(16000);
  });

  it("returns the input unchanged at the target rate and refuses to upsample", () => {
    const x = sine(100, 16000);
    expect(downsample(x, 16000)).toBe(x);
    expect(() => downsample(x, 8000)).toThrow(/upsample/);
  });
});

describe("encodeWav", () => {
  it("writes a valid 16-bit mono PCM header with real sizes", async () => {
    const samples = sine(1600, TARGET_RATE);
    const buf = await encodeWav(samples).arrayBuffer();
    const v = new DataView(buf);
    const tag = (o: number) => String.fromCharCode(...new Uint8Array(buf, o, 4));
    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(v.getUint32(4, true)).toBe(buf.byteLength - 8);
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(34, true)).toBe(16); // bits
    expect(v.getUint32(40, true)).toBe(1600 * 2);
  });

  it("clips out-of-range samples instead of wrapping", async () => {
    const buf = await encodeWav(Float32Array.from([2, -2])).arrayBuffer();
    const v = new DataView(buf);
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
  });
});

describe("helpers", () => {
  it("concatenates recorder chunks in order", () => {
    const out = concatChunks([Float32Array.from([1, 2]), Float32Array.from([3])]);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });

  it("finds the peak absolute level", () => {
    expect(peak(Float32Array.from([0.1, -0.7, 0.3]))).toBeCloseTo(0.7);
    expect(peak(new Float32Array(10))).toBe(0);
  });
});

describe("analyseWav (player waveform)", () => {
  it("reads duration and normalised peaks from our own WAVs", async () => {
    const half = sine(8000, 16000, 440, 0.1);
    const loud = sine(8000, 16000, 440, 0.8);
    const buf = await encodeWav(concatChunks([half, loud])).arrayBuffer();
    const { duration, peaks } = analyseWav(buf, 10);
    expect(duration).toBeCloseTo(1);
    expect(peaks).toHaveLength(10);
    expect(Math.max(...peaks)).toBeCloseTo(1);
    expect(peaks[0]).toBeLessThan(peaks[9]); // quiet half then loud half
  });

  it("skips extra chunks before the data chunk (e.g. LIST metadata)", async () => {
    const plain = new Uint8Array(await encodeWav(sine(1600, 16000)).arrayBuffer());
    const list = new Uint8Array([...new TextEncoder().encode("LIST"), 4, 0, 0, 0, 1, 2, 3, 4]);
    const withList = new Uint8Array(plain.length + list.length);
    withList.set(plain.subarray(0, 36));
    withList.set(list, 36);
    withList.set(plain.subarray(36), 36 + list.length);
    const { duration } = analyseWav(withList.buffer, 8);
    expect(duration).toBeCloseTo(0.1);
  });
});
