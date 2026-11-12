"""Local checks on uploaded audio, so obviously-bad recordings never cost an API call."""

import io
import wave
from array import array
from dataclasses import dataclass

# Prisma accepts these (docs.gnani.ai/api/STT/speech-to-text). Browsers send WAV from our recorder.
ACCEPTED_TYPES = {
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/wave": ".wav",
    "audio/vnd.wave": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/ogg": ".ogg",
    "audio/flac": ".flac",
    "audio/x-flac": ".flac",
    "audio/aac": ".aac",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
}

MAX_BYTES = 6 * 1024 * 1024
MAX_SECONDS = 30.0  # Prisma hard limit
MIN_SECONDS = 0.3
SILENCE_PEAK = 0.01  # fraction of full scale; quieter than this everywhere = nothing said


class AudioRejected(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


@dataclass
class WavInfo:
    seconds: float
    sample_rate: int
    channels: int
    peak: float  # 0..1


def inspect_wav(data: bytes) -> WavInfo:
    try:
        with wave.open(io.BytesIO(data)) as w:
            rate, channels, width, frames = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
            raw = w.readframes(frames)
    except (wave.Error, EOFError) as e:
        raise AudioRejected("bad_audio", "That recording isn't a valid WAV file.") from e

    if rate <= 0 or channels <= 0 or width <= 0:
        raise AudioRejected("bad_audio", "That recording has an invalid format.")
    # Measure from the bytes actually present: some encoders (e.g. streaming TTS) write a
    # placeholder size in the header, which makes getnframes() wildly wrong.
    frames = len(raw) // (width * channels)
    peak = 1.0
    if width == 2 and raw:
        samples = array("h")
        samples.frombytes(raw[: len(raw) - len(raw) % 2])
        peak = max(abs(min(samples)), max(samples)) / 32768
    return WavInfo(seconds=frames / rate, sample_rate=rate, channels=channels, peak=peak)


def check_upload(data: bytes, content_type: str | None) -> str:
    """Validate an uploaded recording. Returns the file extension to send upstream."""
    ctype = (content_type or "").split(";")[0].strip().lower()
    if ctype not in ACCEPTED_TYPES:
        raise AudioRejected("bad_audio", "Unsupported audio format. Record again or type instead.")
    if not data:
        raise AudioRejected("empty", "The recording was empty.")
    if len(data) > MAX_BYTES:
        raise AudioRejected("too_long", "That recording is too large. Keep it under 30 seconds.")

    ext = ACCEPTED_TYPES[ctype]
    if ext == ".wav":
        info = inspect_wav(data)
        if info.seconds > MAX_SECONDS:
            raise AudioRejected("too_long", "That recording is too long. Keep it under 30 seconds.")
        if info.seconds < MIN_SECONDS:
            raise AudioRejected("too_short", "That was too short to catch. Hold the mic a little longer.")
        if info.peak < SILENCE_PEAK:
            raise AudioRejected("silent", "We couldn't hear anything. Check your microphone and try again.")
    return ext
