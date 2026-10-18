/// <reference lib="webworker" />
import type { InstrumentDNA } from '@sonova/instrument-dna';
import { generate, type ArcPreset, type GeneratorResult } from '@sonova/music-generator';
import { renderInstrumentDemo } from '@sonova/synthesis-engine';
import { arrange, encodeWav16, renderArrangement, structureDoc, toMidi, type TrackEdit } from '@sonova/composition-engine';

export type WorkerRequest =
  | { type: 'demo'; id: number; dna: InstrumentDNA }
  | { type: 'generate'; id: number; dnas: InstrumentDNA[]; title: string; seed: string; arc: ArcPreset; ruleGain: Record<string, number>; durationSec: number }
  | { type: 'render'; id: number; dnas: InstrumentDNA[]; gen: GeneratorResult; title: string; edits: TrackEdit[] };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function finish(id: number, dnas: InstrumentDNA[], gen: GeneratorResult, title: string, edits: TrackEdit[]) {
  const arr = arrange(dnas, gen, title, edits);
  const render = renderArrangement(arr, dnas, 44100, (p) => ctx.postMessage({ type: 'progress', id, progress: p }));
  const wav = encodeWav16([render.buffer.left, render.buffer.right], 44100, gen.config.seed);
  const midi = toMidi(arr, gen);
  const { left, right } = render.buffer;
  ctx.postMessage(
    { type: 'done', id, gen, arrangement: arr, structure: structureDoc(arr, gen), master: render.master, renderMs: render.renderMs, left, right, wav, midi },
    [left.buffer, right.buffer, wav.buffer, midi.buffer],
  );
}

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'demo') {
      const demo = renderInstrumentDemo(msg.dna);
      const wav = encodeWav16([demo.buffer.left, demo.buffer.right], 44100, msg.dna.dna_hash);
      const { left, right } = demo.buffer;
      ctx.postMessage({ type: 'done', id: msg.id, left, right, wav, master: demo.report }, [left.buffer, right.buffer, wav.buffer]);
    } else if (msg.type === 'generate') {
      const gen = generate(msg.dnas, { seed: msg.seed, durationSec: msg.durationSec, arc: msg.arc, ruleGain: msg.ruleGain });
      finish(msg.id, msg.dnas, gen, msg.title, []);
    } else {
      finish(msg.id, msg.dnas, msg.gen, msg.title, msg.edits);
    }
  } catch (err) {
    ctx.postMessage({ type: 'error', id: msg.id, error: err instanceof Error ? err.message : String(err) });
  }
};
