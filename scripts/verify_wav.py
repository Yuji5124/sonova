#!/usr/bin/env python3
"""Independent WAV check using only the Python standard library (no NumPy needed).

Usage: python scripts/verify_wav.py file.wav [...] [--expect-seconds 30]
Reports duration, channels, sample rate, bit depth, peak, RMS, clipped samples and silent stretches.
Exit code 1 if any file fails.
"""
import array
import json
import math
import sys
import wave


def check(path, expect_seconds=None):
    with wave.open(path, "rb") as w:
        ch, width, rate, frames = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        if width != 2:
            return {"file": path, "ok": False, "problems": [f"{width * 8}-bit (expected 16-bit)"]}
        data = array.array("h", w.readframes(frames))
    if sys.byteorder == "big":
        data.byteswap()
    peak = max(abs(v) for v in data) if data else 0
    rms = math.sqrt(sum(v * v for v in data) / max(1, len(data)))
    clipped = sum(1 for v in data if v >= 32767 or v <= -32768)
    win = rate // 20
    silent, run, silences = 0, 0, []
    thresh = 32768 * 10 ** (-60 / 20)
    for start in range(0, frames, win):
        block = data[start * ch:(start + win) * ch]
        quiet = (max(abs(v) for v in block) if block else 0) < thresh
        run = run + len(block) // ch if quiet else 0
        if not quiet or start + win >= frames:
            if run == 0 and silences and silences[-1][1] is None:
                silences[-1][1] = start / rate
        if quiet and run == len(block) // ch:
            silences.append([start / rate, None])
        if quiet:
            silent += len(block) // ch
    silences = [[a, b if b is not None else frames / rate] for a, b in silences if (b if b is not None else frames / rate) - a >= 0.5]
    duration = frames / rate
    problems = []
    if rate != 44100:
        problems.append(f"sample rate {rate}")
    if ch != 2:
        problems.append(f"{ch} channels")
    if clipped:
        problems.append(f"{clipped} clipped samples")
    peak_db = 20 * math.log10(peak / 32768) if peak else -math.inf
    rms_db = 20 * math.log10(rms / 32768) if rms else -math.inf
    if peak_db > -0.5:
        problems.append(f"peak {peak_db:.2f} dBFS")
    if rms_db < -40:
        problems.append(f"too quiet ({rms_db:.1f} dBFS)")
    if expect_seconds and abs(duration - expect_seconds) > 0.1:
        problems.append(f"duration {duration:.2f}s")
    return {
        "file": path,
        "ok": not problems,
        "problems": problems,
        "duration": round(duration, 3),
        "channels": ch,
        "sample_rate": rate,
        "bits": width * 8,
        "peak_dbfs": round(peak_db, 2),
        "rms_dbfs": round(rms_db, 2),
        "clipped": clipped,
        "silences_over_0_5s": [[round(a, 2), round(b, 2)] for a, b in silences],
    }


if __name__ == "__main__":
    args = sys.argv[1:]
    expect = None
    if "--expect-seconds" in args:
        i = args.index("--expect-seconds")
        expect = float(args[i + 1])
        del args[i:i + 2]
    results = [check(p, expect) for p in args]
    print(json.dumps(results, indent=2, ensure_ascii=False))
    sys.exit(0 if all(r["ok"] for r in results) else 1)
