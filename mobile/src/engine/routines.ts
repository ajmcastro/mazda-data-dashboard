/**
 * Driving routines (port of `routines.py`, PLAN.md M66): k-medoids (PAM's BUILD start, then alternating steps),
 * k chosen by the mean silhouette. The same algorithm line for line, with the same rounding of the features to
 * 9 decimals (Python and the browser may differ in the last bit of a logarithm or a cosine): change both together.
 */
import { pyRound } from './pyround'

const MIN_K = 2
const MAX_K = 6
const MAX_STEPS = 50

/** Python's float `%` (the result has the sign of the divisor). */
export function pyMod(a: number, b: number): number {
  let m = a % b
  if (m !== 0 && m < 0 !== b < 0) m += b
  return m
}

export function features(km: number[], hours: number[], weekend: boolean[]): number[][] {
  const lengths = km.map((k) => pyRound(Math.log(1 + k), 9))
  const n = lengths.length
  let total = 0
  for (const x of lengths) total += x
  const mean = total / n
  let squares = 0
  for (const x of lengths) squares += (x - mean) ** 2
  const sd = pyRound(Math.sqrt(squares / n), 9) || 1.0
  return lengths.map((l, i) => [
    pyRound((l - mean) / sd, 9),
    pyRound(Math.cos((2 * Math.PI * hours[i]) / 24), 9),
    pyRound(Math.sin((2 * Math.PI * hours[i]) / 24), 9),
    weekend[i] ? 1.0 : 0.0,
  ])
}

export function distances(points: number[][]): number[][] {
  const n = points.length
  const d = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let s = 0
      for (let c = 0; c < points[i].length; c++) s += (points[i][c] - points[j][c]) * (points[i][c] - points[j][c])
      d[i][j] = d[j][i] = Math.sqrt(s)
    }
  }
  return d
}

function nearest(d: number[][], medoids: number[], i: number): number {
  let best = 0
  for (let m = 1; m < medoids.length; m++) if (d[i][medoids[m]] < d[i][medoids[best]]) best = m
  return best
}

/** The index with the smallest key (ties: the lowest index). */
function argmin(items: number[], key: (i: number) => number): number {
  let best = items[0]
  let bestKey = key(best)
  for (const i of items.slice(1)) {
    const k = key(i)
    if (k < bestKey || (k === bestKey && i < best)) {
      best = i
      bestKey = k
    }
  }
  return best
}

export function kmedoids(d: number[][], k: number): [number[], number[]] {
  const n = d.length
  const all = Array.from({ length: n }, (_, i) => i)
  const totals = d.map((row) => {
    let s = 0
    for (const x of row) s += x
    return s
  })
  const medoids = [argmin(all, (i) => totals[i])]
  let near = all.map((i) => d[i][medoids[0]])
  while (medoids.length < k) {
    let best = -1
    let bestGain = -1.0
    for (let c = 0; c < n; c++) {
      if (medoids.includes(c)) continue
      let gain = 0.0
      for (let i = 0; i < n; i++) if (d[i][c] < near[i]) gain += near[i] - d[i][c]
      if (gain > bestGain) {
        best = c
        bestGain = gain
      }
    }
    medoids.push(best)
    near = all.map((i) => Math.min(near[i], d[i][best]))
  }
  let groups = all.map((i) => nearest(d, medoids, i))
  for (let step = 0; step < MAX_STEPS; step++) {
    let changed = false
    for (let g = 0; g < k; g++) {
      const members = all.filter((i) => groups[i] === g)
      if (!members.length) continue
      const centre = argmin(members, (c) => {
        let s = 0
        for (const i of members) s += d[c][i]
        return s
      })
      if (centre !== medoids[g]) {
        medoids[g] = centre
        changed = true
      }
    }
    const next = all.map((i) => nearest(d, medoids, i))
    if (next.some((g, i) => g !== groups[i])) {
      groups = next
      changed = true
    }
    if (!changed) break
  }
  return [medoids, groups]
}

export function silhouette(d: number[][], groups: number[], k: number): number {
  const n = d.length
  let total = 0.0
  for (let i = 0; i < n; i++) {
    const sums = new Array<number>(k).fill(0)
    const counts = new Array<number>(k).fill(0)
    for (let j = 0; j < n; j++) {
      if (j !== i) {
        sums[groups[j]] += d[i][j]
        counts[groups[j]] += 1
      }
    }
    const own = groups[i]
    if (counts[own] === 0) continue
    const a = sums[own] / counts[own]
    let b = Infinity
    for (let g = 0; g < k; g++) if (g !== own && counts[g] > 0) b = Math.min(b, sums[g] / counts[g])
    total += Math.max(a, b) > 0 ? (b - a) / Math.max(a, b) : 0.0
  }
  return total / n
}

export function cluster(points: number[][]): [number, number[], number[], number] {
  const n = points.length
  if (n < 2 * MIN_K) return [1, n ? [0] : [], new Array<number>(n).fill(0), 0.0]
  const d = distances(points)
  let best: [number, number[], number[], number] | null = null
  for (let k = MIN_K; k <= Math.min(MAX_K, n - 1); k++) {
    const [medoids, groups] = kmedoids(d, k)
    const s = silhouette(d, groups, k)
    if (best === null || s > best[3]) best = [k, medoids, groups, s]
  }
  return best!
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function hoursAround(hours: number[]): [number, number, number] {
  let sx = 0
  let sy = 0
  for (const h of hours) sx += pyRound(Math.cos((2 * Math.PI * h) / 24), 9)
  for (const h of hours) sy += pyRound(Math.sin((2 * Math.PI * h) / 24), 9)
  const mean = pyMod(pyRound((Math.atan2(sy, sx) * 24) / (2 * Math.PI), 9), 24)
  const offsets = hours.map((h) => pyMod(h - mean + 12, 24) - 12).sort((a, b) => a - b)
  const n = offsets.length
  const lo = offsets[Math.floor(0.1 * (n - 1))]
  const hi = offsets[Math.ceil(0.9 * (n - 1))]
  return [mean, pyMod(mean + lo, 24), pyMod(mean + hi, 24)]
}
