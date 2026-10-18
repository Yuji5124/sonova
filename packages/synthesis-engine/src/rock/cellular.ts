/**
 * Elementary (Wolfram) 1-D cellular automaton used as a rhythm source: each generation is one
 * bar of 16 cells; live cells become hits. Idea studied in mhitchman/IMS (no licence → ideas only).
 */
export function caStep(cells: boolean[], rule: number): boolean[] {
  const n = cells.length;
  return cells.map((_, i) => {
    const l = cells[(i - 1 + n) % n] ? 4 : 0;
    const c = cells[i] ? 2 : 0;
    const r = cells[(i + 1) % n] ? 1 : 0;
    return ((rule >> (l | c | r)) & 1) === 1;
  });
}

export function caGenerations(seed: boolean[], rule: number, count: number): boolean[][] {
  const gens = [seed];
  for (let i = 1; i < count; i++) gens.push(caStep(gens[i - 1], rule));
  return gens;
}

export const caLabel = (cells: boolean[]) => cells.map((c) => (c ? 'x' : '.')).join('');
