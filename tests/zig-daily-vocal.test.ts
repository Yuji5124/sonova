import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkZigLyrics, decodeWav, encodeWav16, setKana, zigDailyPlan, zigDailyReferences, type VocalLine } from '@sonova/composition-engine';
import type { SoundRecord } from '@sonova/soundvault-adapter';
import { runZigDaily, type RenderedSong, type Renderer } from '../scripts/lib-zig-daily.ts';
import { makeVocalRenderer, voicevoxTakes } from '../scripts/lib-zig-vocal.ts';

const example = JSON.parse(readFileSync(new URL('../docs/examples/zig-daily-lyrics.example.json', import.meta.url), 'utf8'));
const clone = () => JSON.parse(JSON.stringify(example));

// ---------------------------------------------------------------- lyrics validation

describe('ZIG daily lyrics', () => {
  it('accepts the example lyrics', () => {
    const c = checkZigLyrics(example);
    expect(c.problems).toEqual([]);
    expect(c.ok).toBe(true);
    expect(c.lyrics?.title).toBe('TIN LANTERN');
  });

  it('lists every problem and repairs nothing', () => {
    const bad = clone();
    bad.romaji.verse1 = 'kya-kya-kya ma-chi no u-e';
    delete bad.text.pre;
    bad.romaji.chorus = 'a';
    bad.author = '';
    bad.title = 'lower case';
    const c = checkZigLyrics(bad);
    expect(c.ok).toBe(false);
    expect(c.lyrics).toBeUndefined();
    const all = c.problems.join('\n');
    expect(all).toMatch(/kya/);
    expect(all).toMatch(/text\.pre/);
    expect(all).toMatch(/romaji\.chorus/);
    expect(all).toMatch(/author/);
    expect(all).toMatch(/title/);
  });

  it('rejects non-romaji characters, missing sections and non-objects', () => {
    const bad = clone();
    bad.romaji.verse2 = 'ひ-び-わ-れ-た';
    expect(checkZigLyrics(bad).problems.join()).toMatch(/romaji\.verse2/);
    for (const input of [null, 'x', 5, [], {}]) expect(checkZigLyrics(input).ok).toBe(false);
  });

  it('checks an optional intro the same way and keeps it', () => {
    const withIntro = clone();
    withIntro.romaji.intro = 'te-su-to te-su-to / ki-ko-e-ma-su-ka';
    withIntro.text.intro = 'テスト テスト 聞こえますか';
    expect(checkZigLyrics(withIntro).lyrics?.romaji.intro).toBe(withIntro.romaji.intro);
    withIntro.romaji.intro = 'qq';
    expect(checkZigLyrics(withIntro).ok).toBe(false);
  });

  it('a lyricist title is used for the name, and a bad or taken one is refused', () => {
    const p = zigDailyPlan('261028', { title: 'TIN LANTERN' });
    expect(p.displayName).toBe('261028_ZIG_TIN LANTERN');
    expect(p.fileStem).toBe('261028_ZIG_tin-lantern');
    expect(() => zigDailyPlan('261028', { title: 'tin lantern' })).toThrow(/曲名/);
    expect(() => zigDailyPlan('261028', { title: 'TIN LANTERN', takenNames: ['261028_ZIG_TIN LANTERN'] })).toThrow(/使われて/);
    expect(() => zigDailyPlan('261028', { title: 'ROCKET DIVE' })).toThrow(/使われて|禁止/);
    expect(() => zigDailyPlan('261028', { title: '../x' })).toThrow();
  });

  it('a sung song states that its voice and words are new, and still copies nothing', () => {
    const r = zigDailyReferences(true);
    expect(r.noCopying).toContain('旋律・歌詞・音源・声は一切使用していない');
    expect(r.noCopying).toContain('歌詞はこの日のために新しく書いたオリジナル');
    expect(zigDailyReferences(false).noCopying).toContain('歌詞と歌声はなし');
  });
});

// ---------------------------------------------------------------- a fake VOICEVOX Engine (the real one cannot run in CI here)

let server: Server;
const hits: Array<{ path: string; body: any }> = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const path = req.url ?? '';
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      hits.push({ path, body });
      if (path === '/version') return void res.end('"fake"');
      if (path.startsWith('/sing_frame_audio_query')) {
        const phonemes = body.notes.map((n: any) => ({ phoneme: n.key === null ? 'pau' : 'a', frame_length: n.frame_length, note_id: n.id ?? null }));
        const frames = phonemes.reduce((a: number, p: any) => a + p.frame_length, 0);
        res.setHeader('content-type', 'application/json');
        return void res.end(JSON.stringify({ f0: new Array(frames).fill(220), volume: new Array(frames).fill(1), phonemes, volumeScale: 1, outputSamplingRate: 24000, outputStereo: false }));
      }
      if (path.startsWith('/frame_synthesis')) {
        const frames = body.f0.length;
        const n = Math.round((frames / 93.75) * 24000);
        const x = new Float32Array(n).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / 24000));
        res.setHeader('content-type', 'audio/wav');
        return void res.end(Buffer.from(encodeWav16([x], 24000)));
      }
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env.VOICEVOX_URL = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => {
  delete process.env.VOICEVOX_URL;
  await new Promise((r) => server.close(r));
});

const planLine = (section: string, style: VocalLine['style']): VocalLine => ({
  section,
  style,
  text: 'ka-ra-p-po no ma-chi',
  offset: 10,
  seconds: 6,
  melody: [0, 1, 2, 3, 4, 5].map((k) => ({ time: 10.3 + k * 0.4, duration: 0.35, midi: 57 + k, velocity: 0.8 })),
});

describe('VOICEVOX takes (against a fake engine)', () => {
  let cache: string;
  beforeEach(() => {
    cache = mkdtempSync(join(tmpdir(), 'zig-vv-'));
    hits.length = 0;
  });

  it('sings megaphone / pre / chorus sections with the right voices, takes and credits', async () => {
    const t = await voicevoxTakes([planLine('verse1', 'megaphone'), planLine('pre1', 'pre'), planLine('chorus1', 'chorus')], 44100, { cacheDir: cache });
    expect(t.vocals.verse1).toHaveLength(1);
    expect(t.vocals.pre1).toHaveLength(2);
    expect(t.vocals.chorus1).toHaveLength(3);
    expect(t.vocals.verse1[0].fx).toBe('megaphone');
    expect(t.vocals.chorus1.map((x) => x.fx)).toEqual(['rock', 'rock', 'rock-light']);
    expect(t.credits).toEqual(['VOICEVOX:玄野武宏', 'VOICEVOX:白上虎太郎']);
    for (const take of Object.values(t.vocals).flat()) {
      expect(take.x.length).toBe(Math.ceil(6 * 44100));
      expect(take.x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeGreaterThan(0.05); // real audio, resampled to 44.1 kHz
    }
    const synth = hits.filter((h) => h.path.startsWith('/frame_synthesis')).map((h) => h.path);
    expect(synth).toContain('/frame_synthesis?speaker=3040'); // 玄野武宏 ツンギレ
    expect(synth).toContain('/frame_synthesis?speaker=3034'); // 白上虎太郎
    // the lyric kana reached the engine as notes: ka ra ッ→ po …
    const q = hits.find((h) => h.path.startsWith('/sing_frame_audio_query'))!;
    expect(q.body.notes.filter((n: any) => n.lyric).map((n: any) => n.lyric).join('')).toBe(setKana(planLine('x', 'chorus').melody, 'ka-ra-p-po no ma-chi').map((n) => n.lyric).join(''));
  });

  it('freezes the singing queries: the second run asks the engine nothing new for queries', async () => {
    await voicevoxTakes([planLine('verse1', 'megaphone')], 44100, { cacheDir: cache });
    const first = hits.filter((h) => h.path.startsWith('/sing_frame_audio_query')).length;
    expect(first).toBe(1);
    hits.length = 0;
    await voicevoxTakes([planLine('verse1', 'megaphone')], 44100, { cacheDir: cache });
    expect(hits.filter((h) => h.path.startsWith('/sing_frame_audio_query'))).toHaveLength(0);
  });

  it('an engine error fails the run instead of silently dropping the voice', async () => {
    const saved = process.env.VOICEVOX_URL;
    process.env.VOICEVOX_URL = 'http://127.0.0.1:9';
    await expect(voicevoxTakes([planLine('verse1', 'megaphone')], 44100, { cacheDir: cache })).rejects.toThrow();
    process.env.VOICEVOX_URL = saved;
  });

  it('mode "required" fails fast when no engine answers; nothing is rendered', async () => {
    const render = makeVocalRenderer({ lyrics: checkZigLyrics(example).lyrics!, voicevox: 'required', available: async () => false });
    await expect(render(zigDailyPlan('261028'), join(cache, 'a'), () => undefined)).rejects.toThrow(/VOICEVOX Engine に接続できません/);
  });
});

// ---------------------------------------------------------------- the daily run with a sung song

const FAKE_SCANNER = `import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
const sounds = JSON.parse(readFileSync('data/sounds.json', 'utf8'));
for (const s of sounds) { s.size = statSync('public' + s.file).size; s.format = s.file.split('.').pop(); }
writeFileSync('data/sounds.json', JSON.stringify(sounds, null, 2) + '\\n');
mkdirSync('public/data', { recursive: true });
writeFileSync('public/data/sounds.json', JSON.stringify(sounds, null, 2) + '\\n');
`;

function tone(seconds: number): Uint8Array {
  const n = Math.round(seconds * 44100);
  const l = new Float32Array(n).map((_, i) => Math.sin((2 * Math.PI * 220 * i) / 44100) * 0.5);
  return encodeWav16([l, l.slice()], 44100);
}

const sungRenderer = (vocal: NonNullable<RenderedSong['vocal']>): Renderer => async (plan, outDir) => {
  mkdirSync(outDir, { recursive: true });
  const wavPath = join(outDir, `${plan.fileStem}.wav`);
  writeFileSync(wavPath, tone(2));
  return {
    wavPath,
    bpm: plan.bpm,
    key: plan.key,
    durationSec: 2,
    riffText: 'Rm',
    sections: [{ name: 'intro', start: 0, bars: 4 }],
    derivations: [],
    engines: { composition: 'test' },
    sources: [{ name: 'bark.png', sha256: 'aaa' }],
    instruments: [{ instrument_id: 'inst-1', dna_hash: 'h', name: 'bark' }],
    renderMs: 1,
    vocal,
  };
};

describe('ZIG daily run with vocals', () => {
  let vault: string;
  let out: string;
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'zig-vocal-run-'));
    vault = join(dir, 'soundvault');
    out = join(dir, 'out');
    mkdirSync(join(vault, 'scripts'), { recursive: true });
    mkdirSync(join(vault, 'data'), { recursive: true });
    mkdirSync(join(vault, 'public/sounds'), { recursive: true });
    writeFileSync(join(vault, 'package.json'), JSON.stringify({ name: 'soundvault', scripts: { scan: 'node scripts/scan-sounds.mjs' } }));
    writeFileSync(join(vault, 'scripts/scan-sounds.mjs'), FAKE_SCANNER);
    writeFileSync(join(vault, 'data/sounds.json'), '[]');
    writeFileSync(join(vault, 'data/projects.json'), JSON.stringify([{ id: 'sonova', name: 'SONOVA', type: '音楽研究', archived: false }]));
  });
  const sounds = () => JSON.parse(readFileSync(join(vault, 'data/sounds.json'), 'utf8')) as SoundRecord[];
  const go = (vocal: NonNullable<RenderedSong['vocal']>, over = {}) =>
    runZigDaily({ vaultDir: vault, outDir: out, stamp: '261028', lyrics: checkZigLyrics(example).lyrics!, render: sungRenderer(vocal), minDurationSec: 1, ...over });

  it('with VOICEVOX: credit in the license, vocal + voicevox tags, lyrics and engine recorded, lyricist title used', async () => {
    const r = await go({ engine: 'VOICEVOX Engine (歌唱 API・CPU)', credits: ['VOICEVOX:玄野武宏', 'VOICEVOX:白上虎太郎'], stabilize: 0.75 });
    expect(r.status).toBe('registered');
    const rec = sounds()[0] as any;
    expect(rec.name).toBe('261028_ZIG_TIN LANTERN');
    expect(rec.license).toContain('VOICEVOX:玄野武宏 / VOICEVOX:白上虎太郎');
    expect(rec.license).toContain('クレジット表記が必要');
    expect(rec.tags).toEqual(expect.arrayContaining(['vocal', 'voicevox']));
    expect(rec.tags).not.toContain('instrumental');
    expect(rec.sonova.lyrics.text.chorus).toContain('灯せ ランタン');
    expect(rec.sonova.zigDaily.vocal.credits).toHaveLength(2);
    expect(rec.sonova.generation.vocals).toContain('VOICEVOX');
    expect(rec.sonova.references.noCopying).toContain('歌詞はこの日のために新しく書いたオリジナル');
    const record = JSON.parse(readFileSync(join(vault, 'data/zig-daily/261028_ZIG_tin-lantern.json'), 'utf8'));
    expect(record.vocal.engine).toContain('VOICEVOX');
    expect(record.vocal.lyrics.author).toBe('Claude (Sonnet 5.5)');
    expect(record.license).toContain('VOICEVOX');
  });

  it('with the built-in singer after a fallback: no credit needed, the reason is recorded', async () => {
    const r = await go({ engine: 'SONOVA 内蔵の歌手 (物理モデル)', credits: [], fallbackReason: 'VOICEVOX Engine が起動していなかったため' });
    expect(r.status).toBe('registered');
    const rec = sounds()[0] as any;
    expect(rec.license).toBe('Original');
    expect(rec.tags).toContain('vocal');
    expect(rec.tags).not.toContain('voicevox');
    expect(rec.sonova.generation.vocals).toContain('VOICEVOX を使えなかった理由');
  });

  it('a second run the same day renders nothing and writes nothing', async () => {
    await go({ engine: 'x', credits: [] });
    const before = readFileSync(join(vault, 'data/sounds.json'), 'utf8');
    let rendered = 0;
    const r = await runZigDaily({ vaultDir: vault, outDir: out, stamp: '261028', lyrics: checkZigLyrics(example).lyrics!, render: async () => { rendered++; throw new Error('must not render'); }, minDurationSec: 1 });
    expect(r.status).toBe('skipped-existing');
    expect(rendered).toBe(0);
    expect(readFileSync(join(vault, 'data/sounds.json'), 'utf8')).toBe(before);
  });

  it('a lyricist title that is already taken fails the run (no silent rename, nothing written)', async () => {
    writeFileSync(join(vault, 'data/sounds.json'), JSON.stringify([{ id: 'old', name: '261028_ZIG_TIN LANTERN', file: '/sounds/bgm/old.wav', category: 'BGM', tags: [], duration: 1, format: 'wav', size: 1, loop: false, volume: 0.8, sampleRate: 44100, license: 'Original', source: '', author: '', favorite: false, notes: '', collections: [], projectIds: [], createdAt: '2026-01-01T00:00:00Z' }]));
    const r = await go({ engine: 'x', credits: [] }, { allowExtra: true });
    expect(r.status).toBe('failed');
    expect(sounds()).toHaveLength(1);
  });

  it('a renderer that cannot reach a required engine is a failure, never a success', async () => {
    const r = await runZigDaily({ vaultDir: vault, outDir: out, stamp: '261028', lyrics: checkZigLyrics(example).lyrics!, render: makeVocalRenderer({ lyrics: checkZigLyrics(example).lyrics!, voicevox: 'required', available: async () => false }), minDurationSec: 1 });
    expect(r.status).toBe('failed');
    expect(r.message).toContain('VOICEVOX Engine に接続できません');
    expect(sounds()).toHaveLength(0);
  });
});

void decodeWav;
