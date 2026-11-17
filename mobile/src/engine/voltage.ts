/**
 * Battery voltage in the freeze frames (port of `api/voltage.py`, PLAN.md M68): one frame per moment, kept apart by
 * engine state, with a temperature-adjusted Theil-Sen trend and a change point when there are enough frames. The
 * same SQL and the same arithmetic in the same order: keep the two identical.
 */
import type { Handler } from './context'
import { segment } from './changepoints'
import { pyRound } from './pyround'

const STARTING_SECONDS = 60
const MIN_FRAMES = 12
const MIN_DAYS = 4
const MIN_SPAN_DAYS = 60
const MIN_TEMP_GAP = 3.0
const MIN_STEP = 0.3
const MIN_SIDE = 5
const FLAT = 0.05

const FRAMES_SQL =
  'SELECT snapshot_at, ' +
  "coalesce(min(value_num) FILTER (WHERE signal = 'Main_ECU_Voltage_Supply'), " +
  "min(value_num) FILTER (WHERE signal = 'ECU_Power_Voltage')) AS voltage, " +
  "min(value_num) FILTER (WHERE signal = 'Ambient_Air_Temperature') AS ambient, " +
  "min(value_num) FILTER (WHERE signal = 'Engine_RPM') AS rpm, " +
  "min(value_num) FILTER (WHERE signal = 'Time_Since_Engine_Start') AS since_start, " +
  "min(value_num) FILTER (WHERE signal = 'SOC_StateOfCharge') AS soc " +
  'FROM v_frame_signals WHERE snapshot_at IS NOT NULL GROUP BY snapshot_at ORDER BY snapshot_at'

interface Frame {
  at: string
  voltage: number
  ambient: number | null
  rpm: number | null
  since: number | null
  soc: number | null
}

const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const dayOf = (iso: string) => iso.slice(0, 10)
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function theilSen(xs: number[], ys: number[], minGap: number): number | null {
  const slopes: number[] = []
  for (let i = 0; i < xs.length; i++)
    for (let j = i + 1; j < xs.length; j++) if (Math.abs(xs[j] - xs[i]) >= minGap) slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]))
  return median(slopes)
}

function state(f: Frame): string | null {
  if (f.rpm === null) return null
  if (f.rpm <= 0) return 'off'
  return f.since !== null && f.since < STARTING_SECONDS ? 'starting' : 'running'
}

function group(name: string, frames: Frame[]) {
  const dayCount = new Set(frames.map((f) => dayOf(f.at))).size
  const span = frames.length ? days(frames[0].at, frames[frames.length - 1].at) : 0.0
  const volts = frames.map((f) => f.voltage)
  const med = median(volts)
  const out = {
    state: name,
    frames: frames.length,
    days: dayCount,
    first_at: frames.length ? frames[0].at : null,
    last_at: frames.length ? frames[frames.length - 1].at : null,
    span_days: pyRound(span, 1),
    median: volts.length ? pyRound(med!, 2) : null,
    low: volts.length ? pyRound(Math.min(...volts), 2) : null,
    high: volts.length ? pyRound(Math.max(...volts), 2) : null,
    enough: frames.length >= MIN_FRAMES && dayCount >= MIN_DAYS && span >= MIN_SPAN_DAYS,
    per_degree: null as number | null,
    per_30_days: null as number | null,
    flat: null as boolean | null,
    change_at: null as string | null,
    change_before: null as number | null,
    change_after: null as number | null,
  }
  if (!out.enough) return out
  const t0 = frames[0].at
  const t = frames.map((f) => days(t0, f.at))
  const withTemp = frames.filter((f) => f.ambient !== null)
  const perDegree = theilSen(withTemp.map((f) => f.ambient!), withTemp.map((f) => f.voltage), MIN_TEMP_GAP)
  const centre = median(withTemp.map((f) => f.ambient!))
  const adjusted = frames.map((f) => f.voltage - (perDegree !== null && f.ambient !== null ? perDegree * (f.ambient - centre!) : 0))
  const slope = theilSen(t, adjusted, 1.0)
  const segs = segment(adjusted, adjusted.map(() => 1.0), MIN_SIDE, MIN_SIDE, MIN_STEP)
  out.per_degree = perDegree !== null ? pyRound(perDegree, 3) : null
  out.per_30_days = slope !== null ? pyRound(30 * slope, 2) : null
  out.flat = slope !== null ? Math.abs(30 * slope) < FLAT : null
  if (segs.length > 1) {
    out.change_at = frames[segs[1].start].at
    out.change_before = pyRound(segs[0].mean, 2)
    out.change_after = pyRound(segs[1].mean, 2)
  }
  return out
}

export const frameVoltage: Handler = async ({ con }) => {
  const frames: Frame[] = (await con.rows(FRAMES_SQL))
    .map((r) => ({ at: String(r.snapshot_at), voltage: n(r.voltage)!, ambient: n(r.ambient), rpm: n(r.rpm), since: n(r.since_start), soc: n(r.soc) }))
    .filter((f) => f.voltage !== null)
  return {
    starting_seconds: STARTING_SECONDS,
    min_frames: MIN_FRAMES,
    min_days: MIN_DAYS,
    min_span_days: MIN_SPAN_DAYS,
    frames: frames.map((f) => ({ at: f.at, voltage: f.voltage, ambient: f.ambient, soc: f.soc, state: state(f) ?? 'unknown' })),
    groups: ['running', 'off'].map((s) => group(s, frames.filter((f) => state(f) === s))),
  }
}
