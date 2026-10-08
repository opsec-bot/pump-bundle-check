export interface WeightedStat {
  n: number;
  /** Sum of weights. */
  weight: number;
  mean: number;
  /** Standard error of the weighted mean, using the effective sample size (sum w)^2 / sum w^2. */
  stderr: number;
  /** 95% interval, mean +- 1.96 stderr. */
  lo: number;
  hi: number;
}

/** Weighted mean with a standard error. Equal weights give the ordinary mean and stderr. */
export function weightedStat(values: number[], weights?: number[]): WeightedStat {
  const n = values.length;
  if (n === 0) return { n: 0, weight: 0, mean: NaN, stderr: NaN, lo: NaN, hi: NaN };
  const w = weights ?? values.map(() => 1);
  let sw = 0;
  let sw2 = 0;
  let swx = 0;
  for (let i = 0; i < n; i++) {
    sw += w[i]!;
    sw2 += w[i]! * w[i]!;
    swx += w[i]! * values[i]!;
  }
  const mean = swx / sw;
  let swd = 0;
  for (let i = 0; i < n; i++) swd += w[i]! * (values[i]! - mean) ** 2;
  const nEff = (sw * sw) / sw2;
  const variance = nEff > 1 ? (swd / sw) * (nEff / (nEff - 1)) : NaN;
  const stderr = Math.sqrt(variance / nEff);
  return { n, weight: sw, mean, stderr, lo: mean - 1.96 * stderr, hi: mean + 1.96 * stderr };
}

/** Herfindahl-Hirschman index of shares (0..1, 1 = one player has everything). */
export function hhi(amounts: number[]): number {
  const total = amounts.reduce((a, b) => a + b, 0);
  if (total <= 0) return NaN;
  return amounts.reduce((s, a) => s + (a / total) ** 2, 0);
}

/** Gini coefficient of non-negative amounts (0 = equal, near 1 = one holder). */
export function gini(amounts: number[]): number {
  const xs = [...amounts].sort((a, b) => a - b);
  const n = xs.length;
  const total = xs.reduce((a, b) => a + b, 0);
  if (n === 0 || total <= 0) return NaN;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * xs[i]!;
  return (2 * cum) / (n * total) - (n + 1) / n;
}

export function round(x: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
