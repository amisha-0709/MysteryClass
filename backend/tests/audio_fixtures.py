import io
import math
import wave


def make_wav(seconds: float = 1.0, rate: int = 16000, amplitude: float = 0.3, freq: float = 440.0) -> bytes:
    n = int(seconds * rate)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        for i in range(n):
            v = int(amplitude * 32767 * math.sin(2 * math.pi * freq * i / rate))
            frames += v.to_bytes(2, "little", signed=True)
        w.writeframes(bytes(frames))
    return buf.getvalue()
