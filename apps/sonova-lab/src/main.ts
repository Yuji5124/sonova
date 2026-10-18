import './style.css';
import { IMAGE_FEATURE_DESCRIPTIONS, SOURCE_TYPE_STATUS, analyzeImage, sha256Hex, type ImageFeatures, type RGBAImage } from '@sonova/source-analyzer';
import { applyOverrides, createImageDNA, type DnaOverrides, type InstrumentDNA, type InteractionEffect } from '@sonova/instrument-dna';
import { ARC_PRESETS, describeEvent, type ArcPreset, type GeneratorResult } from '@sonova/music-generator';
import {
  EXPERIMENT_PRESETS,
  PHASE1_SEED,
  decodeWav,
  engineVersions,
  experimentMetadata,
  generationManifest,
  verifyAudio,
  workNumberFor,
  type Arrangement,
  type AudioVerification,
  type StructureDoc,
  type TrackEdit,
} from '@sonova/composition-engine';
import type { WorkerRequest } from './render.worker.ts';
import barkUrl from '../../../experiments/sources/bark.png?url';
import towerUrl from '../../../experiments/sources/tower.png?url';
import sunsetUrl from '../../../experiments/sources/sunset.png?url';

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------
interface SourceItem {
  name: string;
  type: 'image';
  sha256: string;
  features: ImageFeatures;
  thumb: string;
}

interface Candidate {
  title: string;
  seed: string;
  arc: ArcPreset;
  workNumber: string;
  stats?: GeneratorResult['stats'];
  bpm?: number;
  mode?: string;
  saved?: { soundvaultId: string; file: string; status: string };
}

interface Project {
  id: string;
  name: string;
  createdAt: string;
  sources: SourceItem[];
  seed: string;
  overrides: Record<string, DnaOverrides>;
  arc: ArcPreset;
  ruleGain: Record<InteractionEffect, number>;
  candidates: Candidate[];
  selected: number;
  edits: TrackEdit[];
}

interface Rendered {
  key: string;
  gen: GeneratorResult;
  arrangement: Arrangement;
  structure: StructureDoc;
  left: Float32Array;
  right: Float32Array;
  wav: Uint8Array;
  midi: Uint8Array;
  verification: AudioVerification;
}

const STORE_KEY = 'sonova-lab:v1';
const DEFAULT_GAIN: Record<InteractionEffect, number> = { resonate: 1, timbre: 1, rhythm: 1, entrain: 1, attract: 1 };
const SCREENS = ['home', 'source', 'instrument', 'generator', 'composition', 'soundvault'] as const;
type Screen = (typeof SCREENS)[number];
const SCREEN_LABEL: Record<Screen, string> = {
  home: 'HOME',
  source: 'SOURCE LAB',
  instrument: 'INSTRUMENT LAB',
  generator: 'MUSIC GENERATOR',
  composition: 'COMPOSITION',
  soundvault: 'SOUNDVAULT',
};

function loadStore(): { projects: Project[]; current: string | null } {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* private mode or corrupted: start empty */
  }
  return { projects: [], current: null };
}

const store = loadStore();
let screen: Screen = 'home';
const rendered = new Map<number, Rendered>();
let busy = '';
let vaultStatus: { vault: { dir: string; ok: boolean; problems: string[]; soundCount?: number; sonovaRecords?: number; pagesUrl?: string; gitHead?: string }; registry: Array<Record<string, string>>; ffmpeg: boolean } | null = null;
let vaultError = '';

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    toast('ブラウザに保存できませんでした (容量制限)');
  }
}

const project = (): Project | undefined => store.projects.find((p) => p.id === store.current);

function newProject(name: string): Project {
  const p: Project = {
    id: `p${Date.now().toString(36)}`,
    name,
    createdAt: new Date().toISOString(),
    sources: [],
    seed: PHASE1_SEED,
    overrides: {},
    arc: 'bloom',
    ruleGain: { ...DEFAULT_GAIN },
    candidates: [],
    selected: 0,
    edits: [],
  };
  store.projects.unshift(p);
  store.current = p.id;
  rendered.clear();
  save();
  return p;
}

function dnasOf(p: Project, withOverrides = true): InstrumentDNA[] {
  return p.sources.map((s) => {
    const dna = createImageDNA({ sourceType: 'image', sourceName: s.name, sourceHash: s.sha256, features: s.features, seed: p.seed });
    return withOverrides ? applyOverrides(dna, p.overrides[dna.instrument_id]) : dna;
  });
}

// ---------------------------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------------------------
let audioCtx: AudioContext | null = null;
let playing: { source: AudioBufferSourceNode; startedAt: number; key: string; duration: number } | null = null;
let masterGain: GainNode | null = null;
let volume = 0.8;

function ensureAudio(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext({ sampleRate: 44100 });
    masterGain = audioCtx.createGain();
    // Safety: renders are limited to −1 dBFS; the volume control can only reduce level.
    masterGain.gain.value = Math.min(1, volume);
    masterGain.connect(audioCtx.destination);
  }
  return audioCtx;
}

function play(key: string, left: Float32Array, right: Float32Array) {
  stop();
  const ctx = ensureAudio();
  void ctx.resume();
  const buf = ctx.createBuffer(2, left.length, 44100);
  buf.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
  buf.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(masterGain!);
  src.onended = () => {
    if (playing?.source === src) {
      playing = null;
      render();
    }
  };
  src.start();
  playing = { source: src, startedAt: ctx.currentTime, key, duration: buf.duration };
  (window as unknown as { __sonovaPlaying: unknown }).__sonovaPlaying = { key, duration: buf.duration, peak: peakOf(left, right) };
  render();
  requestAnimationFrame(drawPlayhead);
}

function stop() {
  if (playing) {
    playing.source.onended = null;
    try {
      playing.source.stop();
    } catch {
      /* already stopped */
    }
    playing = null;
  }
}

const peakOf = (l: Float32Array, r: Float32Array) => {
  let p = 0;
  for (let i = 0; i < l.length; i++) p = Math.max(p, Math.abs(l[i]), Math.abs(r[i]));
  return p;
};

// ---------------------------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------------------------
const worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
let reqId = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (p: number) => void }>();
worker.onmessage = (ev) => {
  const m = ev.data;
  const p = pending.get(m.id);
  if (!p) return;
  if (m.type === 'progress') return p.onProgress?.(m.progress);
  pending.delete(m.id);
  if (m.type === 'error') p.reject(new Error(m.error));
  else p.resolve(m);
};
type Req = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;
function call(msg: Req, onProgress?: (p: number) => void): Promise<any> {
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    worker.postMessage({ ...msg, id });
  });
}

// ---------------------------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------------------------
async function decodeImage(blob: Blob): Promise<RGBAImage & { thumb: string }> {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const c2d = canvas.getContext('2d', { willReadFrequently: true })!;
  c2d.drawImage(bmp, 0, 0);
  const data = c2d.getImageData(0, 0, bmp.width, bmp.height).data;
  const t = document.createElement('canvas');
  t.width = 96;
  t.height = Math.round((96 * bmp.height) / bmp.width);
  t.getContext('2d')!.drawImage(bmp, 0, 0, t.width, t.height);
  return { width: bmp.width, height: bmp.height, data, thumb: t.toDataURL('image/jpeg', 0.8) };
}

async function addSource(name: string, blob: Blob) {
  const p = project() ?? newProject('新しい実験');
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const type = (Object.keys(SOURCE_TYPE_STATUS) as Array<keyof typeof SOURCE_TYPE_STATUS>).find((k) => SOURCE_TYPE_STATUS[k].formats.includes(ext));
  if (!type) return toast(`${name}: 未対応の形式です`);
  if (!SOURCE_TYPE_STATUS[type].implemented) return toast(`${SOURCE_TYPE_STATUS[type].label} は Phase 4 で対応予定です`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const sha256 = await sha256Hex(bytes);
  if (p.sources.some((s) => s.sha256 === sha256)) return toast(`${name} は読み込み済みです`);
  const img = await decodeImage(blob);
  const features = analyzeImage(img);
  p.sources.push({ name, type: 'image', sha256, features, thumb: img.thumb });
  p.candidates = [];
  rendered.clear();
  save();
  render();
}

async function loadSamples() {
  const p = newProject('EVERYTHING IS AN INSTRUMENT #1');
  busy = 'サンプル画像を解析中…';
  render();
  for (const [name, url] of [['bark.png', barkUrl], ['tower.png', towerUrl], ['sunset.png', sunsetUrl]] as const) {
    const blob = await (await fetch(url)).blob();
    await addSource(name, blob);
  }
  p.candidates = [];
  busy = '';
  screen = 'source';
  save();
  render();
}

// ---------------------------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------------------------
async function generateCandidates() {
  const p = project();
  if (!p || p.sources.length < 2) return toast('楽器が2つ以上必要です');
  const dnas = dnasOf(p);
  p.candidates = [];
  p.edits = [];
  rendered.clear();
  const presets = EXPERIMENT_PRESETS.map((preset, i) => ({ ...preset, arc: i === 0 ? p.arc : preset.arc }));
  for (const [i, preset] of presets.entries()) {
    busy = `候補 ${i + 1}/3 を生成中…`;
    render();
    const extra = Object.keys(p.overrides).length || (i === 0 && p.arc !== 'bloom') ? { overrides: p.overrides, arc: preset.arc } : null;
    const workNumber = workNumberFor(preset.seed, dnas, p.ruleGain, [], extra);
    const res = await call({ type: 'generate', dnas, title: preset.title, seed: preset.seed, arc: preset.arc, ruleGain: p.ruleGain, durationSec: 30 }, (pr) => {
      busy = `候補 ${i + 1}/3 をレンダリング中… ${Math.round(pr * 100)}%`;
      const el = document.querySelector('#busy');
      if (el) el.textContent = busy;
    });
    storeRendered(i, res);
    p.candidates.push({ title: preset.title, seed: preset.seed, arc: preset.arc, workNumber, stats: res.gen.stats, bpm: res.gen.bpm, mode: res.gen.key.mode });
  }
  busy = '';
  p.selected = 0;
  save();
  render();
}

function storeRendered(i: number, res: any) {
  const verification = verifyAudio(decodeWav(res.wav), { sampleRate: 44100, channels: 2, bitsPerSample: 16, minDurationSec: 29.9, maxPeakDbfs: -0.9, maxSilentRatio: 0.12 });
  rendered.set(i, { key: `cand${i}`, gen: res.gen, arrangement: res.arrangement, structure: res.structure, left: res.left, right: res.right, wav: res.wav, midi: res.midi, verification });
}

async function ensureRendered(i: number): Promise<Rendered | undefined> {
  const p = project();
  if (!p || !p.candidates[i]) return undefined;
  if (rendered.has(i)) return rendered.get(i);
  const c = p.candidates[i];
  busy = `${c.title} を再生成中…`;
  render();
  const res = await call({ type: 'generate', dnas: dnasOf(p), title: c.title, seed: c.seed, arc: c.arc, ruleGain: p.ruleGain, durationSec: 30 });
  storeRendered(i, res);
  if (i === p.selected && p.edits.length) await rerenderEdits();
  busy = '';
  render();
  return rendered.get(i);
}

async function rerenderEdits() {
  const p = project();
  const r = p && rendered.get(p.selected);
  if (!p || !r) return;
  busy = 'ミックスを再レンダリング中…';
  render();
  const res = await call({ type: 'render', dnas: dnasOf(p), gen: r.gen, title: r.arrangement.title, edits: p.edits });
  storeRendered(p.selected, res);
  const c = p.candidates[p.selected];
  c.workNumber = workNumberFor(c.seed, dnasOf(p), p.ruleGain, p.edits, Object.keys(p.overrides).length ? { overrides: p.overrides, arc: c.arc } : null);
  c.saved = undefined;
  busy = '';
  save();
  render();
}

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------
function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

function exportCandidate(kind: 'wav' | 'midi' | 'dna' | 'structure' | 'generation' | 'events') {
  const p = project();
  const r = p && rendered.get(p.selected);
  if (!p || !r) return;
  const c = p.candidates[p.selected];
  const base = c.workNumber;
  const dnas = dnasOf(p);
  if (kind === 'wav') download(`${base}.wav`, r.wav as Uint8Array<ArrayBuffer>, 'audio/wav');
  if (kind === 'midi') download(`${base}.mid`, r.midi as Uint8Array<ArrayBuffer>, 'audio/midi');
  if (kind === 'dna') download(`${base}.dna.json`, json({ instruments: dnas, overrides: p.overrides }), 'application/json');
  if (kind === 'structure') download(`${base}.structure.json`, json({ ...r.structure, edits: p.edits }), 'application/json');
  if (kind === 'generation') download(`${base}.generation.json`, json({ workNumber: base, ...generationManifest(c.title, dnas, r.gen, new Date().toISOString()), verification: r.verification }), 'application/json');
  if (kind === 'events') download(`${base}.events.json`, json({ events: r.gen.events, snapshots: r.gen.snapshots }), 'application/json');
}

// ---------------------------------------------------------------------------------------------
// SOUNDVAULT (dev server API)
// ---------------------------------------------------------------------------------------------
async function refreshVault() {
  vaultError = '';
  if (!import.meta.env.DEV) {
    vaultError = 'SOUNDVAULT への保存はローカルの開発サーバー (npm run dev) でのみ動作します。静的ビルドでは WAV/JSON を書き出して scripts/soundvault-register.ts を使ってください。';
    return;
  }
  try {
    const res = await fetch('./api/soundvault/status');
    vaultStatus = await res.json();
  } catch (err) {
    vaultError = `状態を取得できません: ${err}`;
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function saveToVault() {
  const p = project();
  const r = p && rendered.get(p.selected);
  if (!p || !r) return;
  const c = p.candidates[p.selected];
  if (!r.verification.ok) return toast(`音声検証に失敗しているため保存しません: ${r.verification.problems.join(', ')}`);
  busy = 'SOUNDVAULT に登録中…';
  vaultError = '';
  render();
  try {
    const meta = experimentMetadata(c.workNumber, r.arrangement, r.gen, dnasOf(p), new Date().toISOString(), [`output/lab/${c.workNumber}.wav`]);
    const res = await fetch('./api/soundvault/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta, wavBase64: toBase64(r.wav), expectations: { sampleRate: 44100, channels: 2, bitsPerSample: 16, minDurationSec: 29.9, maxPeakDbfs: -0.9, maxSilentRatio: 0.12 } }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    c.saved = { soundvaultId: body.result.soundvaultId, file: body.result.file, status: body.result.status };
    save();
    await refreshVault();
    toast(body.result.status === 'already-registered' ? `登録済みです: ${body.result.soundvaultId}` : `登録しました: ${body.result.soundvaultId}`);
  } catch (err) {
    vaultError = `保存エラー: ${err instanceof Error ? err.message : err}`;
  }
  busy = '';
  render();
}

async function playFromVault(file: string) {
  try {
    const res = await fetch(`./soundvault-files${file}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await ensureAudio().decodeAudioData(await res.arrayBuffer());
    play(`vault:${file}`, buf.getChannelData(0), buf.getChannelData(Math.min(1, buf.numberOfChannels - 1)));
    toast(`SOUNDVAULT から再生: ${file} (${buf.duration.toFixed(1)}s)`);
  } catch (err) {
    vaultError = `SOUNDVAULT から再生できません: ${err}`;
    render();
  }
}

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (v: number, d = 3) => (Number.isInteger(v) ? String(v) : v.toFixed(d));
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (m: number) => `${NOTE[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

function viewHome(): string {
  const saved = store.projects.flatMap((p) => p.candidates.filter((c) => c.saved).map((c) => ({ p, c })));
  return `
  <section class="hero">
    <p class="eyebrow">MUSIC BOUNDARY × MUSIC GENERATOR</p>
    <h1>EVERYTHING IS<br>AN INSTRUMENT</h1>
    <p class="lead">写真から楽器をつくり、楽器同士の相互作用から音楽を発生させる。すべての音は、素材・シード・エンジンバージョンから再現できます。</p>
    <div class="row">
      <button class="primary" data-act="samples">サンプル画像3枚で始める</button>
      <button data-act="new">新しい実験</button>
    </div>
  </section>
  <section><h2>プロジェクト</h2>
    ${store.projects.length ? `<div class="grid">${store.projects.map((p) => `
      <article class="card ${p.id === store.current ? 'current' : ''}">
        <div class="thumbs">${p.sources.map((s) => `<img src="${s.thumb}" alt="${esc(s.name)}">`).join('')}</div>
        <h3>${esc(p.name)}</h3>
        <p class="meta">${p.sources.length} 素材 · ${p.candidates.length} 候補 · ${new Date(p.createdAt).toLocaleString()}</p>
        <div class="row"><button data-act="open" data-id="${p.id}">開く</button><button class="ghost" data-act="delete" data-id="${p.id}">削除</button></div>
      </article>`).join('')}</div>` : '<p class="muted">まだプロジェクトはありません。</p>'}
  </section>
  <section><h2>保存済み楽曲 (SOUNDVAULT)</h2>
    ${saved.length ? `<ul class="list">${saved.map(({ p, c }) => `<li><b>${esc(c.workNumber)}</b> ${esc(c.title)} <span class="muted">— ${esc(p.name)} · ${esc(c.saved!.soundvaultId)}</span></li>`).join('')}</ul>` : '<p class="muted">SOUNDVAULT 画面から保存した楽曲がここに並びます。</p>'}
  </section>`;
}

function featureRows(f: ImageFeatures): string {
  const keys: Array<keyof ImageFeatures> = ['meanLuminance', 'contrast', 'meanSaturation', 'colorfulness', 'dominantHue', 'edgeMean', 'edgeDensity', 'verticalness', 'textureRoughness', 'spectralCentroid', 'highFreqRatio', 'repetitionStrength', 'periodX', 'periodY'];
  return keys.map((k) => `<tr><td>${IMAGE_FEATURE_DESCRIPTIONS[k]}</td><td class="num">${fmt(f[k] as number)}</td></tr>`).join('');
}

function bars(values: number[], cls = ''): string {
  const max = Math.max(...values, 1e-9);
  return `<div class="bars ${cls}">${values.map((v) => `<i style="height:${Math.max(2, (v / max) * 100)}%"></i>`).join('')}</div>`;
}

function viewSource(p: Project): string {
  return `
  <section><h2>SOURCE LAB</h2>
    <p class="muted">素材を読み込むと、色・輝度・エッジ・模様・空間周波数・反復構造を解析します。ファイルはブラウザ内で処理され、外部へ送信されません。</p>
    <label class="drop" id="drop"><input type="file" id="file" multiple accept=".png,.jpg,.jpeg,.glb,.gltf,.txt,.md,.py,.js,.ts">
      <span>PNG / JPG をドロップまたはクリック</span>
      <small>${Object.values(SOURCE_TYPE_STATUS).map((s) => `${s.label} ${s.implemented ? '✓' : '(Phase 4)'}`).join(' · ')}</small>
    </label>
    <div class="grid">${p.sources.map((s, i) => `
      <article class="card source">
        <img class="big" src="${s.thumb}" alt="${esc(s.name)}">
        <h3>${esc(s.name)}</h3>
        <p class="meta mono">sha256 ${s.sha256.slice(0, 16)}… · ${s.features.width}×${s.features.height}</p>
        <p class="label">空間周波数 (16帯域)</p>${bars(s.features.radialSpectrum)}
        <p class="label">色相分布 (12)</p>${bars(s.features.hueHistogram, 'hue')}
        <table class="kv">${featureRows(s.features)}</table>
        <button class="ghost" data-act="remove-source" data-i="${i}">取り除く</button>
      </article>`).join('')}</div>
  </section>`;
}

const OVERRIDE_FIELDS: Array<{ key: keyof DnaOverrides; label: string; min: number; max: number; step: number; get: (d: InstrumentDNA) => number }> = [
  { key: 'attack', label: 'Attack (s)', min: 0.002, max: 1.5, step: 0.001, get: (d) => d.attack },
  { key: 'decay', label: 'Decay (s)', min: 0.1, max: 3, step: 0.01, get: (d) => d.decay },
  { key: 'sustain', label: 'Sustain', min: 0.02, max: 0.9, step: 0.01, get: (d) => d.sustain },
  { key: 'release', label: 'Release (s)', min: 0.05, max: 4, step: 0.01, get: (d) => d.release },
  { key: 'brightness', label: 'Brightness', min: 0, max: 1, step: 0.01, get: (d) => d.harmonics.brightness },
  { key: 'noise', label: 'Noise', min: 0, max: 0.7, step: 0.01, get: (d) => d.noise.amount },
  { key: 'fm_index', label: 'FM index', min: 0, max: 4, step: 0.01, get: (d) => d.modulation.fm_index },
  { key: 'octave', label: 'Octave', min: -2, max: 2, step: 1, get: () => 0 },
];

function viewInstrument(p: Project): string {
  const base = dnasOf(p, false);
  const edited = dnasOf(p);
  return `
  <section><h2>INSTRUMENT LAB</h2>
    <div class="row"><label>DNA シード <input id="seed" value="${esc(p.seed)}"></label><button data-act="seed">再生成</button>
    <span class="muted">同じ素材・シード・エンジンバージョン → 同じ DNA。調整値は DNA とは別に「人間の編集」として保存されます。</span></div>
    <div class="grid wide">${base.map((dna, i) => {
      const ov = p.overrides[dna.instrument_id] ?? {};
      const e = edited[i];
      return `
      <article class="card instrument">
        <div class="row between"><h3>${esc(dna.name)}</h3><span class="mono meta">${dna.instrument_id} · ${dna.dna_hash}</span></div>
        <div class="chips">
          <span>音域 ${noteName(e.pitch_range.low)}–${noteName(e.pitch_range.high)}</span>
          <span>主音 ${NOTE[dna.pitch_range.root_pc]}</span>
          <span>E(${dna.rhythm.pulses},${dna.rhythm.steps})</span>
          <span>FM ${dna.modulation.fm_ratio}:1</span>
          ${dna.interaction_rules.responses.map((r) => `<span class="rule ${r.effect}">${r.effect} ${fmt(r.strength, 2)}</span>`).join('')}
        </div>
        <p class="label">倍音 (画像の空間スペクトルから)</p>${bars(dna.harmonics.amplitudes)}
        <div class="sliders">${OVERRIDE_FIELDS.map((f) => `
          <label>${f.label}<input type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${ov[f.key] ?? f.get(dna)}" data-ov="${f.key}" data-inst="${dna.instrument_id}"><output>${fmt((ov[f.key] ?? f.get(dna)) as number)}</output></label>`).join('')}
        </div>
        <div class="row">
          <button class="primary" data-act="audition" data-i="${i}">${playing?.key === `demo${i}` ? '■ 停止' : '▶ 試聴'}</button>
          <button data-act="reset-ov" data-inst="${dna.instrument_id}" ${Object.keys(ov).length ? '' : 'disabled'}>調整を戻す</button>
          <button class="ghost" data-act="dna-json" data-i="${i}">DNA JSON</button>
        </div>
        <details><summary>特徴 → 音の対応表 (${dna.mapping.length})</summary>
          <table class="kv map"><tr><th>パラメータ</th><th>値</th><th>素材の特徴</th><th>理由</th></tr>
          ${dna.mapping.map((m) => `<tr><td class="mono">${esc(m.parameter)}</td><td class="num">${esc(m.value)}</td><td>${m.features.map(esc).join(', ')}</td><td>${esc(m.rule)}</td></tr>`).join('')}</table>
        </details>
      </article>`;
    }).join('')}</div>
  </section>`;
}

function graphSvg(p: Project, dnas: InstrumentDNA[], stats?: GeneratorResult['stats']): string {
  const n = dnas.length;
  const pos = dnas.map((_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [200 + Math.cos(a) * 130, 170 + Math.sin(a) * 120];
  });
  const maxPair = Math.max(1, ...Object.values(stats?.byPair ?? { a: 1 }));
  let edges = '';
  dnas.forEach((dj, j) => {
    dnas.forEach((_, i) => {
      if (i === j) return;
      const count = stats?.byPair[`${i}->${j}`] ?? 0;
      const [x1, y1] = pos[i];
      const [x2, y2] = pos[j];
      const mx = (x1 + x2) / 2 + (y2 - y1) * 0.18;
      const my = (y1 + y2) / 2 - (x2 - x1) * 0.18;
      const w = stats ? 0.6 + (count / maxPair) * 6 : 1.2;
      const effects = dj.interaction_rules.responses.map((r) => r.effect).join('/');
      edges += `<path d="M${x1},${y1} Q${mx},${my} ${x2},${y2}" class="edge" stroke-width="${w}" marker-end="url(#arrow)"><title>${esc(dnas[i].name)} → ${esc(dj.name)}: ${effects}${stats ? ` (${count} 回)` : ''}</title></path>`;
      if (stats && count) edges += `<text x="${mx}" y="${my}" class="edge-label">${count}</text>`;
    });
  });
  const nodes = dnas.map((d, i) => `<g transform="translate(${pos[i][0]},${pos[i][1]})"><circle r="34" class="node"/><text y="-2" class="node-name">${esc(d.name)}</text><text y="14" class="node-sub">${d.interaction_rules.responses.map((r) => r.effect).join('+')}</text></g>`).join('');
  void p;
  return `<svg viewBox="0 0 400 340" class="graph"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="arrowhead"/></marker></defs>${edges}${nodes}</svg>`;
}

function viewGenerator(p: Project): string {
  const dnas = dnasOf(p);
  const sel = rendered.get(p.selected);
  return `
  <section><h2>MUSIC GENERATOR</h2>
    <p class="muted">楽器は独立した状態 (Energy・音色・共鳴・リズム・記憶) を持ち、他の楽器の発音・共鳴・変化に、自分の DNA にある反応ルールで応えます。連鎖の深さ・1ステップあたりの反応数・総エネルギーには上限があり、発散しません。</p>
    <div class="split">
      <div>${graphSvg(p, dnas, sel?.gen.stats)}<p class="muted small">矢印: 送り手 → 受け手 (受け手の反応ルール)。生成後は実際に起きた相互作用の回数で太さが変わります。</p></div>
      <div class="controls">
        <label>展開 (環境条件)<select id="arc">${(Object.keys(ARC_PRESETS) as ArcPreset[]).map((a) => `<option value="${a}" ${p.arc === a ? 'selected' : ''}>${ARC_PRESETS[a].label} — ${ARC_PRESETS[a].description}</option>`).join('')}</select></label>
        <p class="label">相互作用ルールの強さ</p>
        ${(Object.keys(DEFAULT_GAIN) as InteractionEffect[]).map((e) => `<label class="inline">${e}<input type="range" min="0" max="2" step="0.1" value="${p.ruleGain[e]}" data-gain="${e}"><output>${p.ruleGain[e]}</output></label>`).join('')}
        <p class="muted small">シード: ${EXPERIMENT_PRESETS.map((x) => `<code>${x.seed}</code>`).join(' ')}（候補1は選択した展開、候補2・3は TIDE / CASCADE）</p>
        <button class="primary" data-act="generate" ${p.sources.length < 2 ? 'disabled' : ''}>30秒の候補を3つ生成</button>
      </div>
    </div>
  </section>
  ${p.candidates.length ? `<section><h2>候補</h2><div class="grid">${p.candidates.map((c, i) => {
    const r = rendered.get(i);
    return `<article class="card cand ${i === p.selected ? 'current' : ''}">
      <p class="mono meta">${esc(c.workNumber)} · seed ${esc(c.seed)}</p>
      <h3>${esc(c.title)}</h3>
      <div class="chips"><span>${ARC_PRESETS[c.arc].label}</span><span>${c.bpm} BPM</span><span>${esc(c.mode)}</span><span>音 ${c.stats?.notes}</span><span>共鳴 ${c.stats?.resonances}</span><span>変化 ${c.stats?.mutations}</span><span>最大連鎖 ${c.stats?.maxDepthReached}</span></div>
      ${r ? `<p class="small ${r.verification.ok ? 'ok' : 'ng'}">検証 ${r.verification.ok ? 'OK' : 'NG'} · peak ${r.verification.peakDbfs} dBFS · RMS ${r.verification.rmsDbfs} dBFS</p>` : ''}
      <div class="row"><button class="primary" data-act="play-cand" data-i="${i}">${playing?.key === `cand${i}` ? '■ 停止' : '▶ 再生'}</button><button data-act="select" data-i="${i}">${i === p.selected ? '選択中' : 'この候補を選ぶ'}</button></div>
      ${r ? `<details ${i === p.selected ? 'open' : ''}><summary>なぜこう鳴ったか (因果の連鎖)</summary><ol class="chains">${r.gen.chains.map((ch) => `<li><b>${ch.time.toFixed(1)}s</b> ${esc(ch.text)}</li>`).join('')}</ol></details>` : ''}
    </article>`;
  }).join('')}</div></section>` : ''}`;
}

function viewComposition(p: Project): string {
  const c = p.candidates[p.selected];
  if (!c) return `<section><h2>COMPOSITION</h2><p class="muted">MUSIC GENERATOR で候補を生成してください。</p></section>`;
  const r = rendered.get(p.selected);
  if (!r) {
    void ensureRendered(p.selected);
    return `<section><h2>COMPOSITION</h2><p class="muted">再生成しています…</p></section>`;
  }
  const names = r.arrangement.tracks.map((t) => t.name);
  const mutations = r.gen.events.filter((e) => e.kind === 'mutation' || e.kind === 'wake');
  return `
  <section><h2>COMPOSITION — ${esc(c.workNumber)} ${esc(c.title)}</h2>
    <div class="row">
      <button class="primary" data-act="play-cand" data-i="${p.selected}">${playing?.key === `cand${p.selected}` ? '■ 停止' : '▶ 再生'}</button>
      <label class="inline">音量<input type="range" id="volume" min="0" max="1" step="0.01" value="${volume}"></label>
      <span class="muted">${r.arrangement.bpm} BPM · ${NOTE[r.arrangement.key.root_pc]} ${esc(r.arrangement.key.mode)} · ${r.arrangement.durationSec}s</span>
    </div>
    <canvas id="timeline" width="1200" height="${60 + r.arrangement.tracks.length * 86}"></canvas>
    <div class="sections">${r.arrangement.sections.map((s) => `<span title="${esc(s.description)}"><b>${esc(s.name)}</b> ${s.start.toFixed(1)}–${s.end.toFixed(1)}s</span>`).join('')}</div>
    <h3>楽器別トラック</h3>
    <table class="kv tracks"><tr><th>トラック</th><th>音</th><th>共鳴</th><th>定位</th><th>音量</th><th>ミュート</th></tr>
    ${r.arrangement.tracks.map((t, i) => `<tr><td>${esc(t.name)}</td><td class="num">${t.notes.filter((n) => n.kind === 'note').length}</td><td class="num">${t.notes.filter((n) => n.kind === 'resonance').length}</td><td class="num">${fmt(t.pan, 2)}</td>
      <td><input type="range" min="0" max="1.5" step="0.05" value="${p.edits[i]?.gain ?? 1}" data-track-gain="${i}"><output>${p.edits[i]?.gain ?? 1}</output></td>
      <td><input type="checkbox" data-track-mute="${i}" ${p.edits[i]?.mute ? 'checked' : ''}></td></tr>`).join('')}</table>
    <p class="muted small">音量・ミュートは人間の編集として記録され、変更すると作品番号が内容ハッシュに切り替わります (自律生成されたイベント列はそのまま)。</p>
    <h3>書き出し</h3>
    <div class="row">
      <button data-act="export" data-kind="wav">WAV (44.1kHz/16bit/Stereo)</button>
      <button data-act="export" data-kind="midi">MIDI</button>
      <button data-act="export" data-kind="dna">Instrument DNA JSON</button>
      <button data-act="export" data-kind="structure">楽曲構造 JSON</button>
      <button data-act="export" data-kind="generation">生成シード・技術 JSON</button>
      <button data-act="export" data-kind="events">イベント履歴 JSON</button>
    </div>
    <p class="small ${r.verification.ok ? 'ok' : 'ng'}">音声検証: ${r.verification.ok ? 'OK' : esc(r.verification.problems.join(', '))} — ${r.verification.durationSec}s · ${r.verification.channels}ch · ${r.verification.sampleRate}Hz · ${r.verification.bitsPerSample}bit · peak ${r.verification.peakDbfs} dBFS · RMS ${r.verification.rmsDbfs} dBFS · 無音 ${(r.verification.silentRatio * 100).toFixed(1)}%</p>
    <details><summary>イベント履歴 (変化と目覚め ${mutations.length} 件)</summary><ol class="events">${mutations.slice(0, 200).map((e) => `<li><b>${e.time.toFixed(2)}s</b> ${esc(describeEvent(e, names))}${e.cause ? ` <span class="muted">← #${e.cause.event} ${e.cause.rule}</span>` : ''}</li>`).join('')}</ol></details>
  </section>`;
}

function viewVault(p: Project | undefined): string {
  const c = p?.candidates[p.selected];
  const r = p && rendered.get(p.selected);
  const v = vaultStatus?.vault;
  return `
  <section><h2>SOUNDVAULT</h2>
    <p class="muted">SONOVA の音源は既存の SOUNDVAULT (Yuji5124/soundvault) の仕組み — <code>public/sounds/&lt;category&gt;/</code> と <code>data/sounds.json</code>、<code>npm run scan</code> — にそのまま登録します。EXPERIMENT → BGM、INSTRUMENT → FX、COMPOSITION → BGM (コレクションで区別)。</p>
    ${vaultError ? `<p class="error">${esc(vaultError)}</p>` : ''}
    ${v ? `<div class="card"><p><b>保存先</b> <code>${esc(v.dir)}</code> ${v.ok ? '<span class="ok">✓ SOUNDVAULT を確認</span>' : `<span class="ng">${esc(v.problems.join(' / '))}</span>`}</p>
      <p class="muted small">${v.soundCount ?? 0} 件中 SONOVA ${v.sonovaRecords ?? 0} 件 · git ${esc(v.gitHead?.slice(0, 7) ?? '—')} · OGG 変換 ${vaultStatus?.ffmpeg ? 'ffmpeg あり' : 'ffmpeg なし (WAV で登録)'}</p>
      <div class="row"><a class="button" href="${esc(v.pagesUrl ?? '#')}" target="_blank" rel="noopener">公開ページを開く (push 後に反映)</a><button data-act="vault-refresh">再読み込み</button></div></div>` : ''}
    ${c && r ? `<div class="card"><h3>${esc(c.workNumber)} ${esc(c.title)}</h3>
      <p class="small">${c.saved ? `<span class="ok">保存済み</span> 素材ID <code>${esc(c.saved.soundvaultId)}</code> · <code>${esc(c.saved.file)}</code>` : '未保存'}</p>
      <div class="row"><button class="primary" data-act="vault-save" ${v?.ok ? '' : 'disabled'}>SOUNDVAULT へ保存</button>
      ${c.saved ? `<button data-act="vault-play" data-file="${esc(c.saved.file)}">SOUNDVAULT から再生</button>` : ''}</div></div>` : '<p class="muted">COMPOSITION で候補を選ぶと保存できます。</p>'}
    <h3>登録状況 (compositions/soundvault-registry.json)</h3>
    ${vaultStatus?.registry.length ? `<table class="kv"><tr><th>作品番号</th><th>曲名</th><th>素材ID</th><th>ファイル</th><th>再生確認</th><th></th></tr>${vaultStatus.registry.map((e) => `<tr><td class="mono">${esc(e.workNumber)}</td><td>${esc(e.title)}</td><td class="mono">${esc(e.soundvaultId)}</td><td class="mono">${esc(e.file)}</td><td>${(e as any).playback?.ok ? '<span class="ok">✓</span>' : '—'}</td><td><button data-act="vault-play" data-file="${esc(e.file)}">▶</button></td></tr>`).join('')}</table>` : '<p class="muted">登録はまだありません。</p>'}
  </section>`;
}

// ---------------------------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------------------------
const TRACK_COLORS = ['#f2a65a', '#8fb8de', '#e46aa3', '#9ad19a', '#c9a0ff'];
const SECTION_COLORS: Record<string, string> = { emergence: '#1d2433', interaction: '#22283a', bloom: '#33243a', ebb: '#262a33', afterglow: '#1a1f2a' };

function drawTimeline() {
  const p = project();
  const r = p && rendered.get(p.selected);
  const canvas = document.querySelector<HTMLCanvasElement>('#timeline');
  if (!p || !r || !canvas) return;
  const g = canvas.getContext('2d')!;
  const W = canvas.width;
  const dur = r.arrangement.durationSec;
  const x = (t: number) => (t / dur) * W;
  g.clearRect(0, 0, W, canvas.height);
  for (const s of r.arrangement.sections) {
    g.fillStyle = SECTION_COLORS[s.name] ?? '#222';
    g.fillRect(x(s.start), 0, x(s.end) - x(s.start), canvas.height);
    g.fillStyle = '#8b93a7';
    g.font = '12px system-ui';
    g.fillText(s.name.toUpperCase(), x(s.start) + 6, 16);
  }
  // Energy of each instrument (from snapshots) as a faint line.
  r.arrangement.tracks.forEach((t, i) => {
    const top = 40 + i * 86;
    const h = 76;
    g.fillStyle = '#ffffff08';
    g.fillRect(0, top, W, h);
    g.fillStyle = '#c8cedd';
    g.font = '12px system-ui';
    g.fillText(t.name + (p.edits[i]?.mute ? ' (mute)' : ''), 6, top + 13);
    const notes = t.notes;
    const lo = Math.min(...notes.map((n) => n.midi), 127);
    const hi = Math.max(...notes.map((n) => n.midi), 0);
    const y = (m: number) => top + h - 6 - ((m - lo) / Math.max(1, hi - lo)) * (h - 22);
    g.strokeStyle = TRACK_COLORS[i % TRACK_COLORS.length] + '55';
    g.beginPath();
    r.gen.snapshots.forEach((s, k) => {
      const yy = top + h - s.instruments[i].energy * (h - 10);
      if (k === 0) g.moveTo(x(s.time), yy);
      else g.lineTo(x(s.time), yy);
    });
    g.stroke();
    for (const n of notes) {
      const col = TRACK_COLORS[i % TRACK_COLORS.length];
      if (n.kind === 'resonance') {
        g.strokeStyle = col;
        g.globalAlpha = 0.7;
        g.strokeRect(x(n.time), y(n.midi) - 3, Math.max(2, x(n.duration)), 6);
      } else {
        g.fillStyle = col;
        g.globalAlpha = 0.45 + n.velocity * 0.55;
        g.fillRect(x(n.time), y(n.midi) - 3, Math.max(2, x(n.duration)), 6);
      }
      g.globalAlpha = 1;
    }
    for (const e of r.gen.events) {
      if (e.instrument !== i || (e.kind !== 'mutation' && e.kind !== 'wake')) continue;
      g.fillStyle = e.kind === 'wake' ? '#ffffff' : e.param === 'timbre' ? '#ffd166' : e.param === 'rhythm' ? '#06d6a0' : '#a0c4ff';
      const xx = x(e.time);
      g.beginPath();
      g.moveTo(xx, top + 18);
      g.lineTo(xx - 4, top + 26);
      g.lineTo(xx + 4, top + 26);
      g.fill();
    }
  });
}

function drawPlayhead() {
  const p = project();
  const canvas = document.querySelector<HTMLCanvasElement>('#timeline');
  if (!playing || !audioCtx || !canvas || !p || playing.key !== `cand${p.selected}`) return;
  drawTimeline();
  const g = canvas.getContext('2d')!;
  const t = audioCtx.currentTime - playing.startedAt;
  const xx = (t / playing.duration) * canvas.width;
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(xx, 0);
  g.lineTo(xx, canvas.height);
  g.stroke();
  g.lineWidth = 1;
  requestAnimationFrame(drawPlayhead);
}

// ---------------------------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------------------------
let toastTimer = 0;
function toast(msg: string) {
  const el = document.querySelector<HTMLElement>('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 3500);
}

function render() {
  const p = project();
  const app = document.querySelector<HTMLElement>('#app')!;
  const needsProject = screen !== 'home' && screen !== 'soundvault' && !p;
  let body = '';
  if (needsProject) body = `<section><p class="muted">HOME でプロジェクトを開くか作成してください。</p></section>`;
  else if (screen === 'home') body = viewHome();
  else if (screen === 'source') body = viewSource(p!);
  else if (screen === 'instrument') body = viewInstrument(p!);
  else if (screen === 'generator') body = viewGenerator(p!);
  else if (screen === 'composition') body = viewComposition(p!);
  else body = viewVault(p);
  app.innerHTML = `
    <header><div class="brand">SONOVA <span>LAB</span></div>
      <nav>${SCREENS.map((s) => `<button class="tab ${s === screen ? 'active' : ''}" data-screen="${s}">${SCREEN_LABEL[s]}</button>`).join('')}</nav>
      <div class="project-name">${p ? esc(p.name) : ''}</div></header>
    ${busy ? `<div class="busy" id="busy">${esc(busy)}</div>` : ''}
    <main>${body}</main>
    <footer>SONOVA v1.0 · ${esc(Object.values(engineVersions()).join(' · '))} · 無料・ローカル完結・外部 API なし</footer>
    <div id="toast" class="toast"></div>`;
  if (screen === 'composition') drawTimeline();
}

document.addEventListener('click', async (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act],[data-screen]');
  if (!el) return;
  if (el.dataset.screen) {
    screen = el.dataset.screen as Screen;
    if (screen === 'soundvault') await refreshVault();
    return render();
  }
  const p = project();
  const act = el.dataset.act;
  try {
    if (act === 'samples') await loadSamples();
    else if (act === 'new') {
      newProject(`実験 ${store.projects.length + 1}`);
      screen = 'source';
      render();
    } else if (act === 'open') {
      store.current = el.dataset.id!;
      rendered.clear();
      save();
      screen = 'source';
      render();
    } else if (act === 'delete') {
      if (!confirm('このプロジェクトをブラウザから削除しますか? (SOUNDVAULT の登録は消えません)')) return;
      store.projects = store.projects.filter((x) => x.id !== el.dataset.id);
      if (store.current === el.dataset.id) store.current = null;
      save();
      render();
    } else if (act === 'remove-source' && p) {
      p.sources.splice(Number(el.dataset.i), 1);
      p.candidates = [];
      rendered.clear();
      save();
      render();
    } else if (act === 'seed' && p) {
      p.seed = (document.querySelector<HTMLInputElement>('#seed')!.value || PHASE1_SEED).trim();
      p.overrides = {};
      p.candidates = [];
      rendered.clear();
      save();
      render();
    } else if (act === 'audition' && p) {
      const i = Number(el.dataset.i);
      if (playing?.key === `demo${i}`) {
        stop();
        return render();
      }
      busy = '試聴音を合成中…';
      render();
      const res = await call({ type: 'demo', dna: dnasOf(p)[i] });
      busy = '';
      play(`demo${i}`, res.left, res.right);
    } else if (act === 'reset-ov' && p) {
      delete p.overrides[el.dataset.inst!];
      p.candidates = [];
      rendered.clear();
      save();
      render();
    } else if (act === 'dna-json' && p) {
      const dna = dnasOf(p, false)[Number(el.dataset.i)];
      download(`${dna.name}.dna.json`, json({ ...dna, human_overrides: p.overrides[dna.instrument_id] ?? null }), 'application/json');
    } else if (act === 'generate') await generateCandidates();
    else if (act === 'select' && p) {
      p.selected = Number(el.dataset.i);
      p.edits = [];
      save();
      render();
    } else if (act === 'play-cand' && p) {
      const i = Number(el.dataset.i);
      if (playing?.key === `cand${i}`) {
        stop();
        return render();
      }
      const r = await ensureRendered(i);
      if (r) play(`cand${i}`, r.left, r.right);
    } else if (act === 'export') exportCandidate(el.dataset.kind as Parameters<typeof exportCandidate>[0]);
    else if (act === 'vault-refresh') {
      await refreshVault();
      render();
    } else if (act === 'vault-save') await saveToVault();
    else if (act === 'vault-play') await playFromVault(el.dataset.file!);
  } catch (err) {
    busy = '';
    toast(`エラー: ${err instanceof Error ? err.message : err}`);
    render();
  }
});

document.addEventListener('input', (ev) => {
  const el = ev.target as HTMLInputElement;
  const p = project();
  if (!p) return;
  const out = el.nextElementSibling;
  if (out?.tagName === 'OUTPUT') out.textContent = el.value;
  if (el.dataset.ov) {
    const id = el.dataset.inst!;
    p.overrides[id] = { ...p.overrides[id], [el.dataset.ov]: Number(el.value) };
    p.candidates = [];
    rendered.clear();
    save();
  } else if (el.dataset.gain) {
    p.ruleGain[el.dataset.gain as InteractionEffect] = Number(el.value);
    save();
  } else if (el.id === 'volume') {
    volume = Number(el.value);
    if (masterGain) masterGain.gain.value = Math.min(1, volume);
  }
});

document.addEventListener('change', async (ev) => {
  const el = ev.target as HTMLInputElement;
  const p = project();
  if (el.id === 'file' && el.files) {
    for (const f of Array.from(el.files)) await addSource(f.name, f);
  } else if (el.id === 'arc' && p) {
    p.arc = el.value as ArcPreset;
    save();
  } else if (p && (el.dataset.trackGain !== undefined || el.dataset.trackMute !== undefined)) {
    const i = Number(el.dataset.trackGain ?? el.dataset.trackMute);
    p.edits[i] = { ...p.edits[i], ...(el.dataset.trackGain !== undefined ? { gain: Number(el.value) } : { mute: el.checked }) };
    for (let k = 0; k < p.candidates.length; k++) if (k !== p.selected) rendered.delete(k);
    await rerenderEdits();
  } else if (el.dataset.ov) render();
});

document.addEventListener('dragover', (ev) => ev.preventDefault());
document.addEventListener('drop', async (ev) => {
  ev.preventDefault();
  for (const f of Array.from(ev.dataTransfer?.files ?? [])) await addSource(f.name, f);
});

render();
// Test hook: lets the browser check compare DNA hashes with the CLI.
(window as unknown as { __sonova: unknown }).__sonova = { store, rendered, dnas: () => { const p = project(); return p ? dnasOf(p) : []; } };
