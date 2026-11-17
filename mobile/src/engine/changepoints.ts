/**
 * Change points in a weighted series (port of `changepoints.py`, PLAN.md M65): binary segmentation with a
 * penalty. The same algorithm line for line, in the same order of operations so the floating-point sums agree:
 * change both together. Deterministic: ties go to the earliest split.
 */

export const PENALTY = 7.0
const CHI2_MEDIAN = 0.4549364231195724

export interface Segment {
  start: number
  end: number
  weight: number
  count: number
  mean: number
}

function sums(values: number[], weights: number[]): [number[], number[], number[]] {
  const sw = [0]
  const swx = [0]
  const swxx = [0]
  values.forEach((x, i) => {
    const w = weights[i]
    sw.push(sw[sw.length - 1] + w)
    swx.push(swx[swx.length - 1] + w * x)
    swxx.push(swxx[swxx.length - 1] + w * x * x)
  })
  return [sw, swx, swxx]
}

/** The variance of one unit of weight, from neighbours (see the Python docstring). */
export function noise(values: number[], weights: number[]): number {
  const ratios: number[] = []
  for (let i = 1; i < values.length; i++) ratios.push((values[i] - values[i - 1]) ** 2 / (1 / weights[i] + 1 / weights[i - 1]))
  if (!ratios.length) return 0
  ratios.sort((a, b) => a - b)
  const mid = Math.floor(ratios.length / 2)
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2
  return median / CHI2_MEDIAN
}

/** The series cut into segments of constant level, in order (one segment when there is no change). */
export function segment(values: number[], weights: number[], minWeight: number, minCount: number, minStep: number): Segment[] {
  const n = values.length
  if (n === 0) return []
  const [sw, swx, swxx] = sums(values, weights)
  const stats = (a: number, b: number): [number, number, number] => {
    const w = sw[b] - sw[a]
    const m = (swx[b] - swx[a]) / w
    const cost = swxx[b] - swxx[a] - w * m * m
    return [w, m, cost]
  }
  const penalty = PENALTY * noise(values, weights) * Math.log(n)
  const cuts: number[] = []
  const todo: [number, number][] = [[0, n]]
  while (todo.length) {
    const [a, b] = todo.pop()!
    const whole = stats(a, b)[2]
    let best: [number, number] | null = null
    for (let k = a + minCount; k < b - minCount + 1; k++) {
      const [wl, ml, cl] = stats(a, k)
      const [wr, mr, cr] = stats(k, b)
      if (wl < minWeight || wr < minWeight || Math.abs(ml - mr) < minStep) continue
      const gain = whole - cl - cr
      if (best === null || gain > best[0]) best = [gain, k]
    }
    if (best !== null && best[0] > penalty) {
      cuts.push(best[1])
      todo.push([a, best[1]], [best[1], b])
    }
  }
  const bounds = [0, ...cuts.sort((x, y) => x - y), n]
  const out: Segment[] = []
  for (let i = 0; i + 1 < bounds.length; i++) {
    const [a, b] = [bounds[i], bounds[i + 1]]
    const [w, m] = stats(a, b)
    out.push({ start: a, end: b, weight: w, count: b - a, mean: m })
  }
  return out
}
