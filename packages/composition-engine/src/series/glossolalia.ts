/**
 * An invented language for the singer (glossolalia, like Sigur Rós' "Hopelandic" or Magma's Kobaïan).
 * Its sounds come from the voice's source picture: a dark picture sings dark vowels, a soft one
 * sings liquids and nasals, a long-ringing one leaves syllables open. Words are drawn once and
 * the refrain comes back in every chorus, as lyrics do.
 */
import { Rng, clamp, type InstrumentDNA } from '@sonova/instrument-dna';
import type { Consonant, SungNote, Syllable, Vowel } from '@sonova/synthesis-engine';

export interface Language {
  vowels: Record<Vowel, number>;
  onsets: Record<Consonant | '', number>;
  codas: Record<Consonant, number>;
  codaProb: number;
  words: Syllable[][];
  rules: string[];
}

const SOFT: Consonant[] = ['l', 'm', 'n', 'v', 'h', 'r'];
const HARD: Consonant[] = ['k', 't', 's'];

function pick<T extends string>(rng: Rng, w: Record<T, number>): T {
  const keys = Object.keys(w) as T[];
  const sum = keys.reduce((s, k) => s + w[k], 0);
  let x = rng.next() * sum;
  for (const k of keys) {
    x -= w[k];
    if (x <= 0) return k;
  }
  return keys[keys.length - 1];
}

export function inventLanguage(dna: InstrumentDNA, seed: string): Language {
  const rng = new Rng(`glossolalia:${seed}:${dna.dna_hash}`);
  const b = clamp(dna.harmonics.brightness, 0, 1);
  const soft = clamp(dna.attack * 1.4, 0.15, 0.95);
  const vowels: Record<Vowel, number> = { a: 1, e: r3(0.45 + 0.5 * b), i: r3(0.25 + 0.75 * b), o: r3(0.95 - 0.5 * b), u: r3(0.8 - 0.55 * b) };
  const onsets = { '': 0.18 } as Record<Consonant | '', number>;
  for (const c of SOFT) onsets[c] = r3(soft / SOFT.length);
  for (const c of HARD) onsets[c] = r3((1 - soft) / HARD.length);
  const codaProb = r3(clamp(0.38 - 0.17 * dna.decay, 0.06, 0.32));
  const codas: Record<Consonant, number> = { n: 1, l: 0.6, s: r3(0.6 * (1 - soft)) } as Record<Consonant, number>;
  const words: Syllable[][] = [];
  const seen = new Set<string>();
  while (words.length < 9) {
    const len = 1 + Math.floor(rng.next() * 3);
    const w: Syllable[] = [];
    for (let k = 0; k < len; k++) {
      let s: Syllable;
      do {
        const on = pick(rng, onsets);
        s = { vowel: pick(rng, vowels), ...(on ? { onset: on } : {}) };
      } while (w.length && w[w.length - 1].vowel === s.vowel && w[w.length - 1].onset === s.onset);
      if (k === len - 1 && rng.next() < codaProb) s.coda = pick(rng, codas);
      w.push(s);
    }
    const key = romanizeWord(w);
    if (!seen.has(key)) {
      seen.add(key);
      words.push(w);
    }
  }
  return {
    vowels,
    onsets,
    codas,
    codaProb,
    words,
    rules: [
      `母音の重み ← ${dna.name} の明るさ ${b.toFixed(2)} (暗い素材ほど a・o・u)`,
      `子音: やわらかい l m n v h r の割合 ${soft.toFixed(2)} ← 立ち上がりの遅さ ${dna.attack.toFixed(2)}`,
      `閉じた音節 (n・l・s で終わる) の確率 ${codaProb} ← 余韻の長さ ${dna.decay.toFixed(2)} (長く響く素材ほど開いた音節)`,
    ],
  };
}

export const romanize = (s: Syllable) => `${s.onset ?? ''}${s.vowel}${s.coda ?? ''}`;
export const romanizeWord = (w: Syllable[]) => w.map(romanize).join('');

export interface LeadNoteLike {
  time: number;
  duration: number;
  midi: number;
  velocity: number;
  slide?: boolean;
}

/**
 * Put words on a melody. A new syllable on each note that is not a small slide; small slides
 * carry the vowel (melisma), at most two in a row. A long note ends a phrase and the word.
 */
export function setLyrics(notes: LeadNoteLike[], lang: Language, seed: string, variant = 0): { sung: SungNote[]; text: string } {
  const rng = new Rng(`lyrics:${seed}`);
  // the refrain: one fixed sequence of words, reused in every chorus
  // shuffled passes through the lexicon: no word comes back before the others have been sung
  const order: number[] = [];
  while (order.length < 64) {
    const pass = lang.words.map((_, i) => i);
    for (let k = pass.length - 1; k > 0; k--) {
      const j = Math.floor(rng.next() * (k + 1));
      [pass[k], pass[j]] = [pass[j], pass[k]];
    }
    if (order.length && pass[0] === order[order.length - 1]) pass.push(pass.shift()!);
    order.push(...pass);
  }
  if (variant > 0) for (let k = 24; k < 64; k += 5) order[k] = (order[k] + variant * 3) % lang.words.length;
  const sung: SungNote[] = [];
  let wi = 0;
  let si = 0;
  let melisma = 0;
  let text = '';
  notes.forEach((n, k) => {
    const prev = notes[k - 1];
    const small = n.slide && prev && Math.abs(n.midi - prev.midi) <= 2;
    if (k > 0 && small && melisma < 2) {
      melisma++;
      sung.push({ time: n.time, duration: n.duration, midi: n.midi, velocity: n.velocity, syllable: null });
      return;
    }
    melisma = 0;
    const word = lang.words[order[wi % order.length]];
    const syl = word[si];
    sung.push({ time: n.time, duration: n.duration, midi: n.midi, velocity: n.velocity, syllable: syl });
    text += romanize(syl);
    si++;
    const long = n.duration > 0.8;
    if (si >= word.length || long) {
      si = 0;
      wi++;
      text += long ? ' / ' : ' ';
    } else text += '-';
  });
  return { sung, text: text.trim() };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
