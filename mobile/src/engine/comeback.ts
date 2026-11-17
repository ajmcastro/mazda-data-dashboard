/**
 * Fault comeback (port of `api/comeback.py`, PLAN.md M67): for each fault, the waits between a read-out that no
 * longer lists it and the next one that lists it again, and a Kaplan–Meier estimate from three waits that ended.
 * The same SQL and the same walk: keep the two identical.
 */
import type { Handler } from './context'
import { pyRound } from './pyround'

const MIN_ENDED = 3
const DAYS = [7, 30, 90]

const READINGS_SQL =
  'SELECT d.ecu, coalesce(h.triggered_at, h.copied_at) AS read_at, d.transaction_id, d.kind, d.dtc_code ' +
  'FROM dtc_readings d JOIN dtc_headers h USING (transaction_id) ' +
  "WHERE d.kind IN ('none', 'fault') AND coalesce(h.triggered_at, h.copied_at) IS NOT NULL " +
  'ORDER BY d.ecu, read_at, d.transaction_id, d.dtc_code'
const TITLES_SQL =
  'SELECT ecu, dtc_code, any_value(CASE WHEN known THEN title END) AS title FROM v_dtc_events ' + 'GROUP BY ecu, dtc_code'

type Wait = [number, boolean]
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000

export function stillAway(waits: Wait[], t: number): number {
  let share = 1.0
  const times = [...new Set(waits.filter(([d, back]) => back && d <= t).map(([d]) => d))].sort((a, b) => a - b)
  for (const time of times) {
    const atRisk = waits.filter(([d]) => d >= time).length
    const cameBack = waits.filter(([d, back]) => back && d === time).length
    share *= 1 - cameBack / atRisk
  }
  return share
}

export function medianWait(waits: Wait[]): number | null {
  const times = [...new Set(waits.filter(([, back]) => back).map(([d]) => d))].sort((a, b) => a - b)
  for (const time of times) if (stillAway(waits, time) <= 0.5) return time
  return null
}

export const faultComeback: Handler = async ({ con }) => {
  const readouts = new Map<string, string[]>() // ecu -> keys "read_at|tx", in order
  const at = new Map<string, string>() // key -> read_at
  const listed = new Map<string, Set<string>>() // "ecu|key" -> codes
  for (const r of await con.rows(READINGS_SQL)) {
    const ecu = String(r.ecu)
    const key = `${r.read_at}|${r.transaction_id}`
    at.set(key, String(r.read_at))
    if (!readouts.has(ecu)) readouts.set(ecu, [])
    const units = readouts.get(ecu)!
    if (units[units.length - 1] !== key) units.push(key)
    const lk = `${ecu}|${key}`
    if (!listed.has(lk)) listed.set(lk, new Set())
    if (r.kind === 'fault') listed.get(lk)!.add(String(r.dtc_code))
  }
  const titles = new Map<string, unknown>()
  for (const r of await con.rows(TITLES_SQL)) titles.set(`${r.ecu}|${r.dtc_code}`, r.title ?? null)
  const faults: Record<string, unknown>[] = []
  for (const ecu of [...readouts.keys()].sort()) {
    const seq = readouts.get(ecu)!
    const all = new Set<string>()
    for (const k of seq) for (const c of listed.get(`${ecu}|${k}`)!) all.add(c)
    for (const code of [...all].sort()) {
      const waits: { from_at: string; to_at: string | null; days: number; back: boolean }[] = []
      let start: string | null = null
      let seen = false
      let timesListed = 0
      let first: string | null = null
      let last: string | null = null
      for (const k of seq) {
        const when = at.get(k)!
        if (listed.get(`${ecu}|${k}`)!.has(code)) {
          timesListed += 1
          first = first ?? when
          last = when
          if (start !== null) {
            waits.push({ from_at: start, to_at: when, days: pyRound(days(start, when), 1), back: true })
            start = null
          }
          seen = true
        } else if (seen && start === null) start = when
      }
      const newest = at.get(seq[seq.length - 1])!
      if (start !== null) waits.push({ from_at: start, to_at: null, days: pyRound(days(start, newest), 1), back: false })
      const exact: Wait[] = waits.map((w) => [days(w.from_at, w.to_at ?? newest), w.back])
      const ended = waits.filter((w) => w.back).length
      const enough = ended >= MIN_ENDED
      const median = enough ? medianWait(exact) : null
      faults.push({
        ecu,
        dtc_code: code,
        title: titles.get(`${ecu}|${code}`) ?? null,
        readouts: seq.length,
        listed: timesListed,
        first_at: first,
        last_listed_at: last,
        last_read_at: newest,
        listed_now: listed.get(`${ecu}|${seq[seq.length - 1]}`)!.has(code),
        waits,
        ended,
        enough,
        still_away: enough ? DAYS.map((t) => ({ days: t, pct: pyRound(100 * stillAway(exact, t), 1) })) : [],
        median_days: median !== null ? pyRound(median, 1) : null,
      })
    }
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  faults.sort((a, b) => (b.listed as number) - (a.listed as number) || cmp(a.ecu as string, b.ecu as string) || cmp(a.dtc_code as string, b.dtc_code as string))
  return { min_ended: MIN_ENDED, faults }
}
