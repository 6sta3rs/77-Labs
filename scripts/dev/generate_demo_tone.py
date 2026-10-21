"""Generate the public playback fixture without speech, models or recordings."""
from pathlib import Path
import math
import struct
import wave

ROOT = Path(__file__).resolve().parents[2]
DESTINATION = ROOT / "public/demo/interface-tone.wav"


def generate(destination: Path = DESTINATION) -> None:
    rate, duration = 24000, 3.43
    destination.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(destination), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        for index in range(round(rate * duration)):
            time = index / rate
            fade = min(1, time / .08, (duration - time) / .15)
            envelope = .55 + .45 * math.sin(math.pi * time / 1.2) ** 2
            value = .12 * max(0, fade) * envelope * (
                math.sin(math.tau * 220 * time) + .3 * math.sin(math.tau * 440 * time)
            )
            output.writeframesraw(struct.pack("<h", round(32767 * value)))


if __name__ == "__main__":
    generate()
    print("Generated public/demo/interface-tone.wav (procedural tone, no speech).")
