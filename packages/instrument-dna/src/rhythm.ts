/** Euclidean rhythm (Bjorklund-equivalent via Bresenham): `pulses` onsets spread over `steps`, rotated. */
export function euclid(steps: number, pulses: number, rotation = 0): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < steps; i++) {
    const p = (((i + rotation) % steps) + steps) % steps;
    out.push(Math.floor((p * pulses) / steps) !== Math.floor((((p - 1 + steps) % steps) * pulses) / steps) || (pulses > 0 && p === 0));
  }
  return out;
}
