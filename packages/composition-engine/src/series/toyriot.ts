/**
 * SONOVA-TOYRIOT — an original song in the spirit of late-90s Japanese industrial/alternative pop-rock:
 * a radio-noise collage, megaphone verses, a wide gang-vocal chorus, a drum machine layered on the kit,
 * flanged guitars, a toy-keyboard counter-melody and a tape-stop. Nothing is taken from existing songs:
 * the riff, progression and hook come from the SONOVA rock generator, the lyrics are written for it.
 */
import { Rng, type InstrumentDNA } from '@sonova/instrument-dna';
import { generateRock, type RockSong } from '@sonova/music-generator';
import { Biquad, mixInto, pingPong, renderSinger, type Consonant, type SpectroImage, type StereoBuffer, type SungNote, type Syllable, type Vowel } from '@sonova/synthesis-engine';
import { renderRock, type RockBand, type RockRenderResult } from '../rock.ts';

export const TOYRIOT_VERSION = 'sonova-toyriot/1.0.0';

// ---- lyrics (original) -------------------------------------------------------------------------
/** 空っぽの街で ブリキの翼をつけて飛び出す — written for this song. Romaji, syllables split by '-', words by ' '. */
export const TOYRIOT_LYRICS = {
  verse1: 'ka-ra-p-po no ma-chi de / ne-o-n ga ha-ne-ru / bu-ri-ki no tsu-ba-sa / se-na-ka ni tsu-ke-te',
  verse2: 'ka-ga-mi no na-ka de / ni-se-mo-no ga wa-ra-u / ko-wa-re-ta ra-ji-o / bo-ku no ko-e da-ke',
  pre: 'ma-da ta-ri-na-i / mo-t-to o-to wo',
  chorus: 'to-n-de-ke to-n-de-ke / so-ra wo ke-t-to-ba-shi-te / u-so no ho-shi na-n-te / ze-n-bu ko-wa-shi-te-ke',
  intro: 'te-su-to te-su-to / ki-ko-e-ma-su-ka',
};

const SUB: Record<string, Consonant | undefined> = {
  k: 'k', g: 'k', s: 's', z: 's', sh: 's', j: 's', t: 't', d: 't', ch: 't', ts: 't', n: 'n', h: 'h', f: 'h', m: 'm', b: 'v', p: 't', v: 'v', r: 'r', y: undefined, w: undefined,
};

/** Japanese romaji → the singer's phonemes (it has l r m n s h k t v; voiced stops are approximated). */
export function romajiToSyllables(text: string): { syllables: Syllable[]; breaks: number[] } {
  const syllables: Syllable[] = [];
  const breaks: number[] = [];
  for (const phrase of text.split('/')) {
    for (const word of phrase.trim().split(/\s+/)) {
      for (const raw of word.split('-')) {
        const s = raw.toLowerCase();
        if (s === 'n') {
          // moraic n closes the previous syllable
          const prev = syllables[syllables.length - 1];
          if (prev && !prev.coda) prev.coda = 'n';
          else syllables.push({ vowel: 'u', onset: 'n' });
          continue;
        }
        if (s === 'p' || s === 't' || s === 'k') continue; // sokuon: a held stop — the rest does it
        const m = s.match(/^(sh|ch|ts|[kgsztdnhfmbpvrjyw])?y?([aeiou])$/);
        if (!m) continue;
        const onset = m[1] ? SUB[m[1]] : undefined;
        syllables.push({ vowel: m[2] as Vowel, ...(onset ? { onset } : {}) });
      }
    }
    breaks.push(syllables.length);
  }
  return { syllables, breaks };
}

export const romanizeSyl = (s: Syllable) => `${s.onset ?? ''}${s.vowel}${s.coda ?? ''}`;

/** Put syllables on notes: small slides stay on the vowel (melisma), a phrase break waits for a long note. */
function setWords(notes: Array<{ time: number; duration: number; midi: number; velocity: number; slide?: boolean }>, text: string): SungNote[] {
  const { syllables, breaks } = romajiToSyllables(text);
  const out: SungNote[] = [];
  let si = 0;
  let melisma = 0;
  notes.forEach((n, k) => {
    const prev = notes[k - 1];
    const small = n.slide && prev && Math.abs(n.midi - prev.midi) <= 2;
    const atBreak = breaks.includes(si % syllables.length) && si % syllables.length !== 0;
    if (k > 0 && ((small && melisma < 2) || (atBreak && n.duration < 0.5 && melisma < 3))) {
      melisma++;
      out.push({ time: n.time, duration: n.duration, midi: n.midi, velocity: n.velocity, syllable: null });
      return;
    }
    melisma = 0;
    out.push({ time: n.time, duration: n.duration, midi: n.midi, velocity: n.velocity, syllable: syllables[si % syllables.length] });
    si++;
  });
  return out;
}

// ---- small sound tools ------------------------------------------------------------------------
const drive = (x: number, k: number) => Math.tanh(x * k) / Math.tanh(k);

function rmsOf(x: Float32Array): number {
  let s = 0;
  let n = 0;
  for (const v of x) {
    if (Math.abs(v) < 1e-5) continue;
    s += v * v;
    n++;
  }
  return n ? Math.sqrt(s / n) : 0;
}

/** A megaphone / transistor-radio voice: band-limited, overdriven, a little crushed. */
export function megaphone(x: Float32Array, sr: number, amount = 1): Float32Array {
  const hp = new Biquad('highpass', 650, 0.8, sr);
  const hp2 = new Biquad('highpass', 650, 0.8, sr);
  const lp = new Biquad('lowpass', 3400, 0.9, sr);
  const lp2 = new Biquad('lowpass', 3400, 0.9, sr);
  const peak = new Biquad('peaking', 1700, 1.2, sr, 6);
  const r = rmsOf(x) || 1;
  const y = new Float32Array(x.length);
  let held = 0;
  for (let i = 0; i < x.length; i++) {
    let v = lp2.process(lp.process(hp2.process(hp.process(x[i] / (r * 3)))));
    v = peak.process(v);
    v = drive(v, 1 + 5 * amount);
    if (i % 3 === 0) held = Math.round(v * 48) / 48;
    y[i] = (v * (1 - 0.35 * amount) + held * 0.35 * amount) * r * 3;
  }
  return y;
}

function tone(midi: number, dur: number, sr: number, seed: string): Float32Array {
  // toy keyboard: a band-limited square (odd harmonics) with a quick decay and a wobbly cheap vibrato
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const n = Math.ceil((dur + 0.08) * sr);
  const out = new Float32Array(n);
  const rng = new Rng(`toy:${seed}`);
  const wob = 5 + rng.next() * 2;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (f * (1 + 0.006 * Math.sin(2 * Math.PI * wob * t))) / sr;
    let y = 0;
    for (let k = 1; k * f < sr * 0.4 && k <= 15; k += 2) y += Math.sin(2 * Math.PI * k * ph) / k;
    const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.35) * (t < dur ? 1 : Math.max(0, 1 - (t - dur) / 0.08));
    out[i] = Math.round(y * env * 20) / 20; // 4–5-bit-ish toy grit
  }
  return out;
}

// ---- the song --------------------------------------------------------------------------------
export interface ToyRiotResult {
  song: RockSong;
  render: RockRenderResult;
  lyrics: Array<{ section: string; text: string; sung: string; notes: number }>;
  layers: string[];
}

export function renderToyRiot(band: RockBand, seed: string, image: SpectroImage, log: (m: string) => void = () => undefined): ToyRiotResult {
  const song = generateRock(band, seed, 'Tin Wings Riot', {
    bpm: { value: 172, reason: '90 年代後半の J-ロック/インダストリアル・ポップの勢い (パンクの 8 ビートが速すぎない速さ)' },
    rootPc: { value: 4, reason: 'E: ギターの開放弦の最低音 (標準チューニングの 6 弦) で一番太く鳴る調' },
    bars: { value: { intro: 6, outro: 6 }, reason: 'イントロのラジオのコラージュと、最後にラジオが切れる時間' },
  });
  const barSec = song.barSec;
  const sec = (n: string) => song.sections.find((s) => s.name === n)!;
  const chordRoot = (bar: number) => {
    const c = song.events.find((e) => e.part === 'guitar' && e.kind === 'chord' && e.bar === bar);
    return c ? Math.min(...c.midis!) : 40;
  };
  const lyrics: ToyRiotResult['lyrics'] = [];
  const layers: string[] = [];

  const render = renderRock(song, band, image, 44100, log, {
    leadFx: ({ lead, sampleRate }) => {
      // the guitar hook steps back in the choruses: the voice carries it
      for (const c of song.sections.filter((s) => s.name.startsWith('chorus'))) {
        const a = Math.round(c.start * sampleRate);
        const z = Math.min(lead.length, Math.round(c.end * sampleRate));
        for (let i = a; i < z; i++) lead[i] *= 0.45;
      }
    },
    beforeReverb: ({ mix, wet, guitarL, guitarR, drums, drumGain, sampleRate: sr }) => {
      const len = mix.left.length;
      const at = (t: number) => Math.max(0, Math.min(len, Math.round(t * sr)));
      const rng = new Rng(`toyriot:${seed}`);
      const gRef = rmsOf(guitarL.subarray(at(sec('chorus1').start), at(sec('chorus1').end)));
      const dRef = rmsOf(drums.left.subarray(at(sec('chorus1').start), at(sec('chorus1').end))) * drumGain;
      const addMono = (x: Float32Array, t0: number, g: number, pan: number, send = 0) => {
        const gl = Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
        const gr = Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
        const o = at(t0);
        for (let i = 0; i < x.length && o + i < len; i++) {
          mix.left[o + i] += x[i] * g * gl;
          mix.right[o + i] += x[i] * g * gr;
          if (send) {
            wet.left[o + i] += x[i] * g * send;
            wet.right[o + i] += x[i] * g * send;
          }
        }
      };

      // ---- 1. intro: a radio being tuned, a megaphone "mic test", then the band ----
      log('radio collage');
      const intro = sec('intro');
      const keep = intro.end; // the whole intro is the collage; the band comes in on the riff
      for (let i = 0; i < at(keep); i++) {
        mix.left[i] = 0;
        mix.right[i] = 0;
        wet.left[i] = 0;
        wet.right[i] = 0;
      }
      const radioLen = at(keep + 0.3);
      const radio = new Float32Array(radioLen);
      const bp = new Biquad('bandpass', 800, 4, sr);
      for (let i = 0; i < radioLen; i++) {
        const t = i / sr;
        // the dial sweeps; stations whistle past as heterodyne tones
        const dial = 0.5 + 0.5 * Math.sin(t * 0.9) * Math.cos(t * 0.37);
        bp.set('bandpass', 300 + 3800 * dial, 3 + 3 * dial, sr);
        const hiss = bp.process(rng.next() * 2 - 1) * (0.35 + 0.3 * Math.sin(t * 7.3));
        const whistle = Math.sin(2 * Math.PI * (900 + 2600 * dial) * t) * 0.08 * Math.max(0, Math.sin(t * 1.7)) ** 4;
        const crackle = rng.next() < 0.002 ? (rng.next() - 0.5) * 2 : 0;
        radio[i] = (hiss + whistle + crackle) * Math.min(1, t / 0.6) * (t > keep - 0.15 ? Math.max(0, (keep + 0.3 - t) / 0.45) : 1);
      }
      addMono(radio, 0, gRef * 0.5 / (rmsOf(radio) || 1), -0.2, 0.15);
      // the mic test, through the megaphone, landing on the dial's quiet spot
      const ann = romajiToSyllables(TOYRIOT_LYRICS.intro);
      const step = 60 / song.bpm / 2;
      const annNotes: SungNote[] = ann.syllables.map((s, k) => ({ time: 0.2 + k * step + (k >= ann.breaks[0] ? step * 2 : 0), duration: step * 0.95, midi: 55 + (k % 4 === 3 ? 2 : 0), velocity: 0.8, syllable: s }));
      const annVoice = megaphone(renderSinger(annNotes, annNotes.length * step + 2, sr, `${seed}:intro`, { formantScale: 1.03, openQuotient: 0.5, breathiness: 0.1, vibratoCents: 0, scoopCents: 0 }), sr, 1);
      addMono(annVoice, 1.6, (gRef * 1.1) / (rmsOf(annVoice) || 1), 0.15, 0.2);
      lyrics.push({ section: 'intro', text: TOYRIOT_LYRICS.intro, sung: ann.syllables.map(romanizeSyl).join(' '), notes: annNotes.length });
      // count-in: a crushed snare roll in 16ths, getting louder through the last intro bar
      const roll = new Float32Array(at(barSec) + 1);
      const s16 = barSec / 16;
      for (let k = 0; k < 16; k++) {
        const o = Math.round(k * s16 * sr);
        const v = 0.2 + 0.8 * (k / 15) ** 1.5;
        for (let i = 0; i < Math.round(0.08 * sr) && o + i < roll.length; i++) roll[o + i] += Math.round(drive((rng.next() * 2 - 1) * Math.exp(-i / sr / 0.03), 4) * v * 12) / 12;
      }
      addMono(roll, intro.end - barSec, gRef * 0.9 / (rmsOf(roll) || 1), 0.05, 0.2);
      layers.push('イントロ: ラジオのダイヤルを回す雑音 (帯域が動くノイズ・局のうなり・パチパチ) とメガホンの「テスト、テスト、聞こえますか」→ ビット落ちしたスネアの 16 分ロールでバンドが入る');

      // ---- 2. drum machine under the kit: crushed, band-limited, in the verses and choruses ----
      log('drum machine');
      const dm = new Float32Array(len);
      const sx = 60 / song.bpm / 4;
      for (const s of song.sections) {
        const verse = s.name.startsWith('verse');
        const chorus = s.name.startsWith('chorus');
        if (!verse && !chorus && s.name !== 'bridge') continue;
        for (let k = 0; k < s.bars * 16; k++) {
          const t = s.start + k * sx;
          const st = k % 16;
          const hits: Array<[string, number]> = [];
          if (st % 4 === 0) hits.push(['kick', 1]);
          if (st === 4 || st === 12) hits.push(['snare', 1]);
          if (chorus || st % 2 === 0) hits.push(['hat', st % 4 === 2 ? 0.9 : 0.5]);
          if (verse && st === 14 && rng.next() < 0.5) hits.push(['snare', 0.5]);
          for (const [kind, v] of hits) {
            const n = Math.round((kind === 'kick' ? 0.25 : kind === 'snare' ? 0.18 : 0.04) * sr);
            const o = at(t);
            let ph = 0;
            for (let i = 0; i < n && o + i < len; i++) {
              const tt = i / sr;
              let y: number;
              if (kind === 'kick') {
                ph += (2 * Math.PI * 52 * (1 + 2.5 * Math.exp(-tt / 0.02))) / sr;
                y = Math.sin(ph) * Math.exp(-tt / 0.09);
              } else if (kind === 'snare') y = drive((rng.next() * 2 - 1) * Math.exp(-tt / 0.05) + Math.sin(2 * Math.PI * 190 * tt) * Math.exp(-tt / 0.03), 4);
              else y = (rng.next() * 2 - 1) * Math.exp(-tt / 0.008);
              dm[o + i] += y * v;
            }
          }
        }
      }
      // 8-bit-ish crush and a telephone band: the machine sits under the real drums, not on top
      const dhp = new Biquad('highpass', 120, 0.7, sr);
      const dlp = new Biquad('lowpass', 7000, 0.7, sr);
      let hold = 0;
      for (let i = 0; i < len; i++) {
        if (i % 4 === 0) hold = Math.round(dm[i] * 16) / 16;
        dm[i] = dlp.process(dhp.process(hold));
      }
      const dmg = (dRef * 0.55) / (rmsOf(dm) || 1);
      for (let i = 0; i < len; i++) {
        mix.left[i] += dm[i] * dmg * 0.9;
        mix.right[i] += dm[i] * dmg * 1.1;
      }
      layers.push('ドラムマシン: 生ドラムの下に、4 つ打ちのキック・歪んだスネア・16 分のハイハットをビット落ちさせて重ねる (Aメロ・サビ・ブリッジ)');

      // ---- 3. flanger on the guitars in the verses and the bridge (a delayed copy whose delay sweeps 1–7 ms) ----
      log('flanger');
      for (const s of song.sections.filter((x) => x.name.startsWith('verse') || x.name === 'bridge')) {
        const a = at(s.start);
        const z = at(s.end);
        const maxD = Math.round(0.008 * sr);
        for (let i = Math.max(a, maxD + 2); i < z; i++) {
          const t = i / sr;
          const w = Math.min(1, (i - a) / (0.2 * sr), (z - i) / (0.2 * sr));
          const dl = (0.001 + 0.003 * (1 + Math.sin(2 * Math.PI * 0.22 * t))) * sr;
          const dr = (0.001 + 0.003 * (1 + Math.cos(2 * Math.PI * 0.22 * t))) * sr;
          const read = (x: Float32Array, d: number) => {
            const p = i - d;
            const k = Math.floor(p);
            return x[k] * (1 - (p - k)) + x[k + 1] * (p - k);
          };
          mix.left[i] += read(guitarL, dl) * 0.75 * w;
          mix.right[i] += read(guitarR, dr) * 0.75 * w;
        }
      }
      layers.push('フランジャー: Aメロとブリッジのギターに、1〜7 ms で揺れる遅れた複製を足す (ジェット音)');

      // ---- 4. toy keyboard counter-melody in the riff sections ----
      log('toy keyboard');
      const penta = [0, 3, 5, 7, 10];
      for (const s of song.sections.filter((x) => x.name.startsWith('riff') || x.name === 'outro')) {
        let deg = 2;
        for (let k = 0; k < s.bars * 8; k++) {
          if (k % 8 === 7 || rng.next() < 0.2) continue;
          deg = Math.max(0, Math.min(9, deg + [-1, 1, 1, 2, -2][Math.floor(rng.next() * 5)]));
          const m = 64 + 12 + penta[deg % 5] + 12 * Math.floor(deg / 5);
          const t = s.start + k * (barSec / 8);
          addMono(tone(m, barSec / 8 * 0.8, sr, `${s.name}${k}`), t, gRef * 0.45, k % 2 ? 0.55 : -0.55, 0.25);
        }
      }
      layers.push('おもちゃのキーボード: リフの区間で、粗い矩形波 (奇数倍音だけ・ビット落ち・安っぽいビブラート) の対旋律');

      // ---- 5. vocals ----
      const voices: Array<{ section: string; notes: SungNote[]; style: 'megaphone' | 'pre' | 'chorus'; text: string }> = [];
      for (const name of ['verse1', 'verse2']) {
        const s = sec(name);
        const notes: Array<{ time: number; duration: number; midi: number; velocity: number }> = [];
        const vr = new Rng(`verse:${seed}:${name}`);
        // a punky, talky line: 8ths with gaps, chord tones of the bar around E3–B3, the 4th bar of each 4 answers higher
        for (let b = 0; b < s.bars; b++) {
          const root = chordRoot(s.startBar + b);
          const pcs = [0, 3, 7, 10].map((iv) => 52 + ((root + iv - 52) % 12 + 12) % 12);
          for (let k = 0; k < 8; k++) {
            if (k === 7 || (k === 0 && b % 2 === 1) || vr.next() < 0.15) continue;
            const hi = b % 4 === 3 ? 5 : 0;
            const m = pcs[Math.floor(vr.next() * pcs.length)] + hi;
            notes.push({ time: s.start + b * barSec + k * (barSec / 8), duration: barSec / 8 * (k === 6 ? 1.8 : 0.9), midi: m, velocity: 0.75 + 0.2 * vr.next() });
          }
        }
        voices.push({ section: name, notes: setWords(notes, TOYRIOT_LYRICS[name as 'verse1' | 'verse2']), style: 'megaphone', text: TOYRIOT_LYRICS[name as 'verse1'] });
      }
      for (const name of ['pre1', 'pre2', 'pre3']) {
        const s = sec(name);
        const notes: Array<{ time: number; duration: number; midi: number; velocity: number }> = [];
        // rising quarter notes on the chord's third and fifth: a staircase into the chorus
        for (let b = 0; b < s.bars; b++) {
          const root = chordRoot(s.startBar + b);
          for (let k = 0; k < 4; k++) {
            const m = 55 + ((root + [4, 7, 7, 12][k] - 55) % 12 + 12) % 12 + Math.floor(b / 2) * 2;
            notes.push({ time: s.start + b * barSec + k * (barSec / 4), duration: barSec / 4 * 0.95, midi: m, velocity: 0.8 + 0.05 * b });
          }
        }
        voices.push({ section: name, notes: setWords(notes, TOYRIOT_LYRICS.pre), style: 'pre', text: TOYRIOT_LYRICS.pre });
      }
      for (const s of song.sections.filter((x) => x.name.startsWith('chorus'))) {
        const lead = song.events.filter((e) => e.part === 'lead' && e.kind === 'note' && e.time >= s.start && e.time < s.end);
        const fold = (m: number) => {
          let x = m;
          while (x > 66) x -= 12;
          while (x < 54) x += 12;
          return x;
        };
        const notes = lead.map((e) => ({ time: e.time, duration: e.duration!, midi: fold(e.midi!), velocity: e.velocity!, slide: e.slide }));
        voices.push({ section: s.name, notes: setWords(notes, TOYRIOT_LYRICS.chorus), style: 'chorus', text: TOYRIOT_LYRICS.chorus });
      }
      const hall = { left: new Float32Array(len), right: new Float32Array(len) };
      for (const v of voices) {
        log(`vocal ${v.section}`);
        const s = sec(v.section);
        const off = s.start - 0.3;
        const rel = v.notes.map((n) => ({ ...n, time: n.time - off }));
        const segSec = s.end - s.start + 1.5;
        const base = { formantScale: 1.03, openQuotient: 0.5, breathiness: 0.12, vibratoCents: 18, scoopCents: 45 };
        const takes: Array<{ x: Float32Array; pan: number; g: number }> = [];
        if (v.style === 'megaphone') takes.push({ x: megaphone(renderSinger(rel, segSec, sr, `${seed}:${v.section}`, base), sr, 0.9), pan: 0, g: 1 });
        else if (v.style === 'pre') {
          takes.push({ x: renderSinger(rel, segSec, sr, `${seed}:${v.section}`, base), pan: -0.12, g: 0.8 });
          takes.push({ x: megaphone(renderSinger(rel, segSec, sr, `${seed}:${v.section}:m`, { ...base, formantScale: 1.06 }), sr, 0.5), pan: 0.12, g: 0.6 });
        } else {
          takes.push({ x: renderSinger(rel, segSec, sr, `${seed}:${v.section}:L`, base), pan: -0.35, g: 0.85 });
          takes.push({ x: renderSinger(rel.map((n) => ({ ...n, time: n.time + 0.014, midi: n.midi + 0.07 })), segSec, sr, `${seed}:${v.section}:R`, { ...base, breathiness: 0.16, vibratoRate: 5.0 }), pan: 0.35, g: 0.85 });
          takes.push({ x: renderSinger(rel.map((n) => ({ ...n, midi: n.midi + 12 })), segSec, sr, `${seed}:${v.section}:oct`, { ...base, formantScale: 1.12, openQuotient: 0.6, breathiness: 0.2 }), pan: 0, g: 0.42 });
        }
        const target = gRef * (v.style === 'chorus' ? 1.5 : 1.35);
        const dry = new Float32Array(takes[0].x.length);
        for (const tk of takes) {
          const g = (target * tk.g) / (rmsOf(tk.x) || 1);
          addMono(tk.x, off, g, tk.pan);
          for (let i = 0; i < dry.length; i++) dry[i] += tk.x[i] * g;
        }
        // a slap in the verses, a dotted-eighth echo in the choruses, and the hall
        const delay = v.style === 'megaphone' ? 0.11 : (60 / song.bpm) * 0.75;
        const [pl, pr] = pingPong(dry, new Float32Array(dry.length), sr, delay, v.style === 'megaphone' ? 0.15 : 0.32, 0.4);
        const o = at(off);
        for (let i = 0; i < dry.length && o + i < len; i++) {
          mix.left[o + i] += pl[i] * 0.22;
          mix.right[o + i] += pr[i] * 0.22;
          hall.left[o + i] += dry[i] * (v.style === 'chorus' ? 0.3 : 0.15);
          hall.right[o + i] += dry[i] * (v.style === 'chorus' ? 0.3 : 0.15);
        }
        lyrics.push({ section: v.section, text: v.text, sung: v.notes.filter((n) => n.syllable).map((n) => romanizeSyl(n.syllable!)).join(' '), notes: v.notes.length });
      }
      for (let i = 0; i < len; i++) {
        wet.left[i] += hall.left[i];
        wet.right[i] += hall.right[i];
      }
      layers.push('歌: Aメロはメガホン (650 Hz–3.4 kHz、歪み、ビット落ち) + 短いスラップ / Bメロは素の声とメガホンの 2 声 / サビは左右のダブル + 1 オクターブ上のコーラス、付点 8 分のエコー');

      // ---- 6. tape stop at the end of chorus 2 (the band slows down to nothing) ----
      log('tape stop');
      const c2 = sec('chorus2');
      const ts = at(c2.end - barSec);
      const te = at(c2.end);
      for (const buf of [mix, wet] as StereoBuffer[]) {
        const L = buf.left.slice(ts, te);
        const R = buf.right.slice(ts, te);
        let p = 0;
        for (let i = 0; i < te - ts; i++) {
          const u = i / (te - ts);
          const speed = Math.max(0, 1 - u * 1.15);
          const k = Math.floor(p);
          const f = p - k;
          const g = Math.min(1, (1 - u) * 4);
          buf.left[ts + i] = ((L[k] ?? 0) * (1 - f) + (L[k + 1] ?? 0) * f) * g;
          buf.right[ts + i] = ((R[k] ?? 0) * (1 - f) + (R[k + 1] ?? 0) * f) * g;
          p += speed;
        }
      }
      layers.push('テープストップ: サビ2 の最後の 1 小節、バンド全体の再生速度が 1 → 0 に落ちて音程ごと止まる → ブリッジ');

      // ---- 7. the end: the song shrinks back into the radio and the dial turns away ----
      log('radio out');
      const out = sec('outro');
      const ra = at(out.end - barSec * 2);
      const rz = Math.min(len, at(out.end + 3));
      const r1 = new Biquad('highpass', 500, 0.8, sr);
      const r2 = new Biquad('lowpass', 2800, 0.8, sr);
      const r3 = new Biquad('highpass', 500, 0.8, sr);
      const r4 = new Biquad('lowpass', 2800, 0.8, sr);
      for (let i = ra; i < rz; i++) {
        const u = Math.min(1, (i - ra) / (rz - ra));
        const m = Math.min(1, u * 3);
        const l = r2.process(r1.process(mix.left[i]));
        const r = r4.process(r3.process(mix.right[i]));
        const hiss = (rng.next() * 2 - 1) * 0.02 * m;
        const g = 1 - u * u;
        mix.left[i] = (mix.left[i] * (1 - m) + (l + hiss) * m) * g;
        mix.right[i] = (mix.right[i] * (1 - m) + (r + hiss) * m) * g;
        wet.left[i] *= 1 - m;
        wet.right[i] *= 1 - m;
      }
      layers.push('終わり: 最後の 2 小節で曲がラジオの帯域に縮み、雑音と一緒に遠ざかる');
      void mixInto;
    },
  });
  return { song, render, lyrics, layers };
}

export type { InstrumentDNA };
