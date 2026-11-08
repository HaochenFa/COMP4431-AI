"""Read-aloud voices: Kokoro-82M (the kokoro-onnx build), running on the laptop, so the demo works offline.

The model lives in data/tts/ (~353 MB, gitignored). It's downloaded from the kokoro-onnx releases on
first use if it isn't there:

    uv run python -m app.tts            # self-test: load time, voices, a sample to data/tts/sample.wav
    uv run python -m app.tts --fetch    # just download the model

/tts answers 503 while the model loads or downloads (or if that failed), and the app reads the line with an
iOS voice instead.
"""

from __future__ import annotations

import io
import sys
import threading
import time
import wave
from collections import OrderedDict
from pathlib import Path

import numpy as np

from .paths import DATA

MODEL_DIR = DATA / "tts"
RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
FILES = ("kokoro-v1.0.onnx", "voices-v1.0.bin")
SAMPLE_RATE = 24_000
# English voices only: the prefix is the accent (a = American, b = British) and the gender.
ENGLISH = ("af_", "am_", "bf_", "bm_")
DEFAULT_VOICE = "af_heart"  # the most natural of Kokoro's voices
MAX_CHARS = 800  # a plan summary is ~300


def fetch(folder: Path = MODEL_DIR, force: bool = False, log=print) -> None:
    """Download the model (Apache-2.0) from the kokoro-onnx releases."""
    import httpx

    folder.mkdir(parents=True, exist_ok=True)
    with httpx.Client(follow_redirects=True, timeout=httpx.Timeout(30, read=120)) as client:
        for name in FILES:
            path = folder / name
            if path.exists() and not force:
                continue
            log(f"tts: downloading {name}")
            part = path.with_suffix(path.suffix + ".part")
            with client.stream("GET", RELEASE + name) as r:
                r.raise_for_status()
                with part.open("wb") as f:
                    for chunk in r.iter_bytes(1 << 20):
                        f.write(chunk)
            part.rename(path)  # only a complete download gets the real name


def to_wav(audio: np.ndarray, rate: int = SAMPLE_RATE) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
    return buf.getvalue()


class NotReady(Exception):
    """The model is still loading or downloading, or failed to: the app falls back to an iOS voice."""


class Speaker:
    """Loads the model once (in the background at startup) and keeps the last few clips."""

    def __init__(self, folder: Path = MODEL_DIR, cache_size: int = 32):
        self.folder = folder
        self.kokoro = None
        self.status = "idle"  # idle | downloading | loading | ready | failed: <error>
        self._load_lock = threading.Lock()
        self._synth_lock = threading.Lock()
        self._clips: OrderedDict[tuple[str, str, float], bytes] = OrderedDict()
        self._cache_size = cache_size

    def load(self) -> None:
        """Blocking: download the model if it's missing, then load it. Safe to call more than once."""
        with self._load_lock:
            if self.kokoro:
                return
            try:
                if not all((self.folder / f).exists() for f in FILES):
                    self.status = "downloading"
                    fetch(self.folder)
                self.status = "loading"
                from kokoro_onnx import Kokoro

                kokoro = Kokoro(str(self.folder / FILES[0]), str(self.folder / FILES[1]))
                kokoro.create("Ready.", voice=DEFAULT_VOICE, speed=1.0, lang="en-us")  # the first run is slow; not the first plan's
                self.kokoro = kokoro
                self.status = "ready"
            except Exception as e:  # noqa: BLE001  (a broken TTS must never take the server down)
                self.status = f"failed: {e}"

    def warm(self) -> None:
        """Start loading in a background thread (server startup)."""
        threading.Thread(target=self.load, name="tts-load", daemon=True).start()

    def voices(self) -> list[str]:
        return sorted(v for v in self.kokoro.get_voices() if v.startswith(ENGLISH)) if self.kokoro else []

    def synth(self, text: str, voice: str, speed: float) -> np.ndarray:
        audio, _ = self.kokoro.create(text, voice=voice, speed=speed, lang="en-gb" if voice.startswith("b") else "en-us")
        return audio

    def wav(self, text: str, voice: str, speed: float = 1.0) -> bytes:
        if not self.kokoro:
            raise NotReady(self.status)
        if voice not in self.voices():
            raise ValueError(f"unknown voice {voice!r}")
        key = (text, voice, round(speed, 2))
        if key in self._clips:
            self._clips.move_to_end(key)
            return self._clips[key]
        with self._synth_lock:
            clip = to_wav(self.synth(text, voice, speed))
        self._clips[key] = clip
        while len(self._clips) > self._cache_size:
            self._clips.popitem(last=False)
        return clip


speaker = Speaker()


def main() -> None:
    if "--fetch" in sys.argv:
        fetch(force="--force" in sys.argv)
        return
    t = time.perf_counter()
    s = Speaker()
    s.load()
    if not s.kokoro:
        sys.exit(f"tts: {s.status}")
    print(f"loaded in {time.perf_counter() - t:.1f} s; voices: {', '.join(s.voices())}")
    t = time.perf_counter()
    clip = s.wav("Good to go. Dragon's Back takes about three hours, and you'll finish well before sunset.", DEFAULT_VOICE)
    out = s.folder / "sample.wav"
    out.write_bytes(clip)
    print(f"{DEFAULT_VOICE}: {(len(clip) - 44) / 2 / SAMPLE_RATE:.1f} s of speech in {time.perf_counter() - t:.1f} s -> {out}")


if __name__ == "__main__":
    main()
