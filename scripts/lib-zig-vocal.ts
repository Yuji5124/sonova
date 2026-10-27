/**
 * ZIG daily song with vocals. Same band and riffs as the instrumental daily song, plus a sung vocal on the TOYRIOT /
 * PSYLO production (megaphone verses, pre-chorus, rock-processed chorus), the words being the day's original lyrics.
 *
 * Who sings:
 *   VOICEVOX Engine (local, CPU, free) when it answers on VOICEVOX_URL — male voices, credit required when shared
 *   otherwise SONOVA's built-in singer (physical model, no engine at all)    (mode "auto")
 *   mode "required" fails instead of falling back; mode "off" always uses the built-in singer.
 * Nothing here calls a cloud service. The VOICEVOX Engine must be started by the caller (it is not downloaded here).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateRock } from '@sonova/music-generator';
import { PSYLO_VERSION, ROCK_RENDER_VERSION, applyPsyloRiffs, engineVersions, renderToyRiot, rockToMidi, setKana, songLyricsOf, toyRiotVocalPlan, type ExternalTake, type KanaNote, type VocalLine, type ZigLyrics } from '@sonova/composition-engine';
import { ROCK_VERSION } from '@sonova/music-generator';
import { MALE_VOICES, singLine, voicevoxAvailable } from './lib-voicevox.ts';
import { bandAndImage, type Renderer } from './lib-zig-daily.ts';
import { ROOT, writeStereoWav } from './lib.ts';

export type VoicevoxMode = 'auto' | 'off' | 'required';
export const VOCAL_STABILIZE = 0.75; // same steadier-singer setting as PSYLO

export interface VocalRendererOptions {
  lyrics: ZigLyrics;
  voicevox?: VoicevoxMode;
  /** frozen VOICEVOX singing queries (same score → same audio) */
  cacheDir?: string;
  /** test hook: replaces voicevoxAvailable() */
  available?: () => Promise<boolean>;
  /** test hook: replaces the VOICEVOX sing call */
  sing?: typeof singLine;
}

/** The takes VOICEVOX sings for a vocal plan: one voice for the verse, two for the pre-chorus, a double + a gang for the chorus. */
export async function voicevoxTakes(plan: VocalLine[], sr: number, o: { cacheDir: string; sing?: typeof singLine; log?: (m: string) => void }): Promise<{ vocals: Record<string, ExternalTake[]>; credits: string[] }> {
  const sing = o.sing ?? singLine;
  const V = MALE_VOICES;
  const credits = new Set<string>();
  const vocals: Record<string, ExternalTake[]> = {};
  for (const line of plan) {
    const kana: KanaNote[] = (line.kana ?? setKana(line.melody, line.text)).map((n) => ({ ...n, time: n.time - line.offset }));
    const one = async (voice: keyof typeof V, extra: Parameters<typeof singLine>[4] = {}) => {
      credits.add(V[voice].credit);
      return (await sing(kana, line.seconds, sr, V[voice].id, { stabilize: VOCAL_STABILIZE, ...extra, cacheDir: o.cacheDir, label: `${line.section}${extra.transpose ? `-t${extra.transpose}` : ''}` })).x;
    };
    o.log?.(`VOICEVOX ${line.section}`);
    if (line.style === 'megaphone') vocals[line.section] = [{ x: await one('takehiroTsun'), pan: 0, gain: 1, fx: 'megaphone' }];
    else if (line.style === 'pre')
      vocals[line.section] = [
        { x: await one('takehiro'), pan: -0.12, gain: 0.8, fx: 'rock-light' },
        { x: await one('takehiroTsun'), pan: 0.12, gain: 0.6, fx: 'megaphone' },
      ];
    else
      vocals[line.section] = [
        { x: await one('takehiroTsun'), pan: -0.3, gain: 0.85, fx: 'rock' },
        { x: await one('takehiro', { delay: 0.014, cents: 7 }), pan: 0.3, gain: 0.85, fx: 'rock' },
        { x: await one('kotarouOko', { transpose: 12 }), pan: 0, gain: 0.42, fx: 'rock-light' },
      ];
  }
  return { vocals, credits: [...credits].sort() };
}

export function makeVocalRenderer(o: VocalRendererOptions): Renderer {
  const mode = o.voicevox ?? 'auto';
  return async (plan, outDir, log) => {
    // decide who sings before the slow work: "required" must fail fast
    let up = false;
    if (mode !== 'off') {
      up = await (o.available ?? voicevoxAvailable)();
      if (!up && mode === 'required') throw new Error('VOICEVOX Engine に接続できません (VOICEVOX_URL, 既定 http://127.0.0.1:50021)。--voicevox required のため中止します');
    }
    const { dnas, sources, band, image } = await bandAndImage();
    // same song as the instrumental daily song, with room at both ends for the radio intro and outro
    const song = applyPsyloRiffs(
      generateRock(band, plan.seed, plan.title, {
        ...plan.rockOptions,
        bars: { value: { intro: 6, outro: 6 }, reason: 'ラジオのイントロ (「テスト、テスト」) と、最後にラジオへ戻る時間' },
      }),
    );
    const vplan = toyRiotVocalPlan(song, plan.seed, songLyricsOf(o.lyrics));

    let engine = 'SONOVA 内蔵の歌手 (物理モデル)';
    let credits: string[] = [];
    let fallbackReason = '';
    let vocals: Record<string, ExternalTake[]> | undefined;
    if (mode !== 'off') {
      if (!up) {
        fallbackReason = 'VOICEVOX Engine が起動していなかったため';
        log(`VOICEVOX Engine が見つかりません → SONOVA 内蔵の歌手で歌います`);
      } else {
        const t = await voicevoxTakes(vplan, 44100, { cacheDir: o.cacheDir ?? join(ROOT, 'output/zig-daily/vocal-queries'), sing: o.sing, log });
        vocals = t.vocals;
        credits = t.credits;
        engine = 'VOICEVOX Engine (歌唱 API・CPU)';
      }
    }
    const r = renderToyRiot(band, plan.seed, image, log, {
      song,
      plan: vplan,
      vocals,
      vocalCredit: credits.join(' / ') || undefined,
      chorusLead: 0.45,
      ...(o.lyrics.romaji.intro ? { intro: { text: o.lyrics.romaji.intro } } : {}),
    });
    mkdirSync(outDir, { recursive: true });
    const wavPath = join(outDir, `${plan.fileStem}.wav`);
    writeStereoWav(wavPath, r.render.buffer, plan.seed);
    writeFileSync(join(outDir, `${plan.fileStem}.mid`), rockToMidi(r.song));
    return {
      wavPath,
      bpm: r.song.bpm,
      key: plan.key,
      durationSec: r.song.durationSec,
      riffText: r.song.riffText,
      sections: r.song.sections.map((s) => ({ name: s.name, start: s.start, bars: s.bars })),
      derivations: r.song.derivations,
      engines: { ...engineVersions(), rock: ROCK_VERSION, rock_render: ROCK_RENDER_VERSION, psylo_riffs: PSYLO_VERSION },
      sources: sources.map((s) => ({ name: s.name, sha256: s.sha256 })),
      instruments: dnas.map((d) => ({ instrument_id: d.instrument_id, dna_hash: d.dna_hash, name: d.name })),
      renderMs: r.render.renderMs,
      vocal: { engine, credits, ...(fallbackReason ? { fallbackReason } : {}), ...(vocals ? { stabilize: VOCAL_STABILIZE } : {}) },
    };
  };
}
