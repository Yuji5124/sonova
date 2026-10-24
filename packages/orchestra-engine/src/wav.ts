/** PCM WAV read (16/24/32-bit int, 32-bit float, any channel count) and 24-bit write. */
export interface Audio {
  sampleRate: number;
  channels: Float32Array[];
}

export function decodeWavAny(bytes: Uint8Array): Audio {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let fmt = 1;
  let ch = 1;
  let sr = 44100;
  let bits = 16;
  let o = 12;
  while (o + 8 <= bytes.length) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      fmt = v.getUint16(body, true);
      ch = v.getUint16(body + 2, true);
      sr = v.getUint32(body + 4, true);
      bits = v.getUint16(body + 14, true);
      if (fmt === 0xfffe) fmt = v.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE: sub-format
    } else if (id === 'data') {
      const bps = bits / 8;
      const frames = Math.floor(Math.min(size, bytes.length - body) / (bps * ch));
      const channels = Array.from({ length: ch }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++)
        for (let c = 0; c < ch; c++) {
          const p = body + (i * ch + c) * bps;
          let x: number;
          if (fmt === 3 && bits === 32) x = v.getFloat32(p, true);
          else if (bits === 16) x = v.getInt16(p, true) / 32768;
          else if (bits === 24) x = ((v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16)) as number) / 8388608;
          else if (bits === 32) x = v.getInt32(p, true) / 2147483648;
          else if (bits === 8) x = (v.getUint8(p) - 128) / 128;
          else throw new Error(`unsupported WAV: ${bits}-bit format ${fmt}`);
          channels[c][i] = x;
        }
      return { sampleRate: sr, channels };
    }
    o = body + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

/** 24-bit PCM, no dither (24-bit quantisation noise is far below audibility), clipped at ±1. */
export function encodeWav24(channels: Float32Array[], sampleRate: number): Uint8Array {
  const n = channels[0].length;
  const ch = channels.length;
  const data = n * ch * 3;
  const out = new Uint8Array(44 + data);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * ch * 3, true);
  v.setUint16(32, ch * 3, true);
  v.setUint16(34, 24, true);
  str(36, 'data');
  v.setUint32(40, data, true);
  let p = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, channels[c][i]));
      let q = Math.round(x * 8388607);
      if (q < 0) q += 1 << 24;
      out[p++] = q & 255;
      out[p++] = (q >> 8) & 255;
      out[p++] = (q >> 16) & 255;
    }
  return out;
}
