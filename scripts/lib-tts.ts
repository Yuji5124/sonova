/**
 * Spoken English for announcements, with free local engines only:
 *   1. Piper (github.com/rhasspy/piper, MIT; the `piper-tts` package) with the LibriTTS voice
 *      `en-us-libritts-high` (dataset CC BY 4.0 — credit "LibriTTS (CC BY 4.0)"), from the piper v0.0.2 release:
 *      https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-en-us-libritts-high.tar.gz
 *      PIPER_BIN=…/piper PIPER_MODEL=…/en-us-libritts-high.onnx [PIPER_SPEAKER=3]
 *   2. otherwise espeak-ng (github.com/espeak-ng/espeak-ng, GPL-3.0): a formant ("robot") voice
 * Noise scales are 0 so Piper is deterministic: the same text gives the same audio.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeWav } from '@sonova/composition-engine';

export interface Speech {
  x: Float32Array;
  engine: string;
  credit: string;
}

const which = (bin: string) => {
  try {
    execFileSync('which', [bin], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

export function speakEnglish(text: string, sr: number, o: { speaker?: number; lengthScale?: number; engine?: 'piper' | 'espeak' } = {}): Speech {
  const dir = mkdtempSync(join(tmpdir(), 'sonova-tts-'));
  const out = join(dir, 'speech.wav');
  try {
    const piper = process.env.PIPER_BIN ?? 'piper';
    const model = process.env.PIPER_MODEL;
    const speaker = o.speaker ?? Number(process.env.PIPER_SPEAKER ?? 3);
    let engine: string;
    let credit: string;
    if (o.engine !== 'espeak' && model && existsSync(model) && (existsSync(piper) || which(piper))) {
      execFileSync(piper, ['-m', model, '-s', String(speaker), '--noise-scale', '0', '--noise-w-scale', '0', '--length-scale', String(o.lengthScale ?? 1.12), '-f', out], { input: text, stdio: ['pipe', 'pipe', 'pipe'] });
      const cfg = existsSync(`${model}.json`) ? JSON.parse(readFileSync(`${model}.json`, 'utf8')) : {};
      const libri = Object.entries((cfg.speaker_id_map ?? {}) as Record<string, number>).find(([, v]) => v === speaker)?.[0];
      engine = `Piper (${model.split('/').pop()}, speaker ${speaker}${libri ? ` = LibriTTS ${libri}` : ''})`;
      credit = 'Voice: Piper (MIT) + LibriTTS (CC BY 4.0)';
    } else if (o.engine !== 'piper' && which('espeak-ng')) {
      execFileSync('espeak-ng', ['-v', 'en-us+m3', '-s', '138', '-p', '30', '-w', out, text]);
      engine = 'espeak-ng (en-us+m3)';
      credit = 'Voice: eSpeak NG';
    } else throw new Error('no English TTS: install piper-tts (PIPER_BIN, PIPER_MODEL) or espeak-ng');
    const d = decodeWav(new Uint8Array(readFileSync(out)));
    const src = d.data[0];
    const ratio = d.sampleRate / sr;
    const x = new Float32Array(Math.ceil((src.length / d.sampleRate) * sr));
    for (let i = 0; i < x.length; i++) {
      const p = i * ratio;
      const k = Math.floor(p);
      const f = p - k;
      x[i] = (src[k] ?? 0) * (1 - f) + (src[k + 1] ?? 0) * f;
    }
    return { x, engine, credit };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
