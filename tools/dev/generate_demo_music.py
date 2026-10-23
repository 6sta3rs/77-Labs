"""Create Signal Bloom: original, deterministic music for the public orb demo.

No downloaded samples, voice recordings, models, or external packages are used.
The score and synthesis are provided under the repository's license.
"""
from array import array
from pathlib import Path
import hashlib
import json
import math
import random
import struct
import wave

ROOT = Path(__file__).resolve().parents[2]
RATE, DURATION, BPM = 24000, 24.0, 100
BEAT = 60 / BPM


def generate(destination: Path) -> dict:
    count = round(RATE * DURATION)
    left, right = array("d", [0.0]) * count, array("d", [0.0]) * count
    rng = random.Random(77)

    def add(start, duration, sample, gain=1.0, pan=0.0):
        first = round(start * RATE)
        size = min(round(duration * RATE), count - first)
        l_gain, r_gain = math.sqrt((1 - pan) / 2), math.sqrt((1 + pan) / 2)
        for index in range(max(0, size)):
            value = gain * sample(index / RATE)
            left[first + index] += value * l_gain
            right[first + index] += value * r_gain

    def frequency(note):
        return 440 * 2 ** ((note - 69) / 12)

    chords = [(45, 52, 57, 60, 64), (41, 48, 53, 57, 60),
              (48, 55, 60, 64, 67), (43, 50, 55, 59, 64),
              (45, 52, 57, 60, 64), (41, 48, 53, 57, 60),
              (48, 55, 60, 64, 67), (43, 50, 55, 59, 64),
              (38, 45, 50, 53, 57), (45, 52, 57, 60, 64)]
    melody = [0, 2, 4, 2, 1, 4, 3, 2, 0, 3, 4, 2, 1, 2, 4, 3]
    for bar, chord in enumerate(chords):
        start = bar * 4 * BEAT
        for index, note in enumerate(chord[2:]):
            hz = frequency(note)
            add(start, 4.5 * BEAT,
                lambda t, hz=hz: min(1, t / .12) * math.exp(-t / 1.1)
                * (math.sin(math.tau * hz * t) + .2 * math.sin(math.tau * hz * 2.003 * t)),
                .075, (index - 1) * .65)
        for step in range(16):
            hz = frequency(chord[melody[(step + bar * 3) % len(melody)]] + 12)
            add(start + step * BEAT / 4, .38,
                lambda t, hz=hz: min(1, t / .008) * math.exp(-t / .1)
                * math.sin(math.tau * hz * t + .7 * math.sin(math.tau * hz * 2 * t) * math.exp(-t / .07)),
                .13, math.sin(step * 1.9) * .55)
        for step in range(8):
            hz = frequency(chord[0] + (12 if step in (3, 7) else 0))
            add(start + step * BEAT / 2, BEAT * .44,
                lambda t, hz=hz: min(1, t / .006) * math.exp(-t / .14)
                * (math.sin(math.tau * hz * t) + .14 * math.sin(math.tau * hz * 2 * t)), .4)
            # Bright, short hats provide a contrasting high-frequency signal.
            noise = [rng.uniform(-1, 1) for _ in range(round(.065 * RATE))]
            add(start + step * BEAT / 2, .065,
                lambda t, noise=noise: noise[min(len(noise) - 1, int(t * RATE))]
                * math.exp(-t / .014) * math.sin(math.tau * 7200 * t), .055, .35)
        for beat in range(4):
            add(start + beat * BEAT, .32,
                lambda t: math.exp(-t / .085) * math.sin(math.tau * (45 * t + 6.5 * (1 - math.exp(-t * 25)))), .75)
            if beat % 2:
                noise = [rng.uniform(-1, 1) for _ in range(round(.16 * RATE))]
                add(start + beat * BEAT, .16,
                    lambda t, noise=noise: math.exp(-t / .043)
                    * (.75 * noise[min(len(noise) - 1, int(t * RATE))] + .25 * math.sin(math.tau * 180 * t)), .22, -.2)
    peak = max(max(abs(value) for value in left), max(abs(value) for value in right))
    gain = .84 / max(peak, .001)
    destination.parent.mkdir(parents=True, exist_ok=True)
    pcm = bytearray()
    for index in range(count):
        time = index / RATE
        fade = min(1, time / .04, (DURATION - time) / .65)
        pcm.extend(struct.pack("<hh", round(32767 * gain * fade * left[index]), round(32767 * gain * fade * right[index])))
    with wave.open(str(destination), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(pcm)
    return {"title": "Signal Bloom", "duration": DURATION, "bpm": BPM, "sampleRate": RATE,
            "channels": 2, "source": "Original score and procedural synthesis; no samples or speech",
            "sha256": hashlib.sha256(destination.read_bytes()).hexdigest()}


if __name__ == "__main__":
    print(json.dumps(generate(ROOT / "public/demo/orb-music.wav")))
