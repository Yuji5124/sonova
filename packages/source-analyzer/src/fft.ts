// In-place iterative radix-2 FFT. `re`/`im` length must be a power of two.
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** 2D power spectrum of a square `size`×`size` grid (row-major). */
export function powerSpectrum2D(values: Float64Array, size: number): Float64Array {
  const re = new Float64Array(size * size);
  const im = new Float64Array(size * size);
  re.set(values);
  const rowRe = new Float64Array(size);
  const rowIm = new Float64Array(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      rowRe[x] = re[y * size + x];
      rowIm[x] = im[y * size + x];
    }
    fft(rowRe, rowIm);
    for (let x = 0; x < size; x++) {
      re[y * size + x] = rowRe[x];
      im[y * size + x] = rowIm[x];
    }
  }
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      rowRe[y] = re[y * size + x];
      rowIm[y] = im[y * size + x];
    }
    fft(rowRe, rowIm);
    for (let y = 0; y < size; y++) {
      re[y * size + x] = rowRe[y];
      im[y * size + x] = rowIm[y];
    }
  }
  const power = new Float64Array(size * size);
  for (let i = 0; i < power.length; i++) power[i] = re[i] * re[i] + im[i] * im[i];
  return power;
}
