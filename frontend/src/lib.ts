// Formatting helpers. Timestamps come from the API as ISO strings in UTC and render in
// the browser's local timezone.

const num = (digits: number) =>
  new Intl.NumberFormat('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits })

const formats = [num(0), num(1), num(2)]

export function fmtNum(v: number | null | undefined, digits = 0, unit = ''): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return formats[digits].format(v) + (unit ? ` ${unit}` : '')
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function fmtTick(v: number): string {
  return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fmtDateTimeSec(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function fmtAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

export const ts = (iso: string): number => new Date(iso).getTime()

/**
 * Pivot long (day, code, events) rows into one row per calendar day (gaps filled with
 * zeros) with a column per chosen code, so a category axis spaces bars evenly.
 */
export function pivotDaily(
  rows: { day: string; code: string; events: number }[],
  codes: string[],
): Record<string, number | string>[] {
  const byDay = new Map<string, Record<string, number>>()
  for (const r of rows) {
    if (!codes.includes(r.code)) continue
    const row = byDay.get(r.day) ?? {}
    row[r.code] = r.events
    byDay.set(r.day, row)
  }
  const days = [...byDay.keys()].sort()
  if (days.length === 0) return []
  const out: Record<string, number | string>[] = []
  const end = ts(`${days[days.length - 1]}T00:00:00Z`)
  for (let t = ts(`${days[0]}T00:00:00Z`); t <= end; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10)
    out.push({ day, ...Object.fromEntries(codes.map((c) => [c, 0])), ...byDay.get(day) })
  }
  return out
}

export const SEVERITY_BADGE: Record<string, string> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
  unknown: 'dim',
}

// Units of the freeze-frame signals in the snapshot CSV. They match the diagnostic tool's own
// printout of the same frames (e.g. Vehicle_Speed = VSS in km/h); signals not listed have no
// known unit and are shown raw.
const SIGNAL_UNITS: Record<string, string> = {
  Vehicle_Speed: 'km/h',
  Engine_RPM: 'rpm',
  Ambient_Air_Temperature: '°C',
  Engine_Coolant_Temperature: '°C',
  SOC_StateOfCharge: '%',
  Main_ECU_Voltage_Supply: 'V',
  ECU_Power_Voltage: 'V',
  Vehicle_Odometer_Information: 'km',
  IG_OnTimer: 'min',
  Global_Real_Time: 'min',
  Time_Since_Engine_Start: 's',
  Relative_Accelerator_Pedal_Position: '%',
}

export function signalLabel(signal: string): string {
  const text = signal.replaceAll('_', ' ')
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

export function signalValue(signal: string, value: string | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const unit = SIGNAL_UNITS[signal]
  return unit ? `${value}\u202f${unit}` : value
}

/** Charts skip their draw-in animation when the user asks for reduced motion. */
export const ANIMATE =
  typeof window === 'undefined' || !window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ---- date range (calendar days in UTC, "YYYY-MM-DD") ----

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** The string if it is a real calendar day, otherwise undefined. */
export function parseDay(value: string | null | undefined): string | undefined {
  if (!value || !DAY_RE.test(value)) return undefined
  const d = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? undefined : value
}

export type DayRange = { from?: string; to?: string }

/** Drops invalid days and swaps the bounds if they were given the wrong way round. */
export function sanitizeRange(from: string | null | undefined, to: string | null | undefined): DayRange {
  const a = parseDay(from)
  const b = parseDay(to)
  if (a && b && a > b) return { from: b, to: a }
  return { from: a, to: b }
}

/** Number of calendar days in the range, both ends included. */
export function daysInRange(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}

/** Keeps `from <= to` after the user edits one of the two bounds. */
export function editRange(range: DayRange, edited: 'from' | 'to', value: string): DayRange {
  const day = parseDay(value)
  const next = { ...range, [edited]: day }
  if (day && edited === 'from' && next.to && day > next.to) next.to = day
  if (day && edited === 'to' && next.from && day < next.from) next.from = day
  return next
}

// ---- quick ranges ----
// Presets count back from the most recent day with data, not from today: an export is a
// snapshot, so "last 30 days" counted from today would be empty a few weeks after the export.

export type PresetId = 'week' | 'fortnight' | '30d' | '60d' | '90d' | 'all'

export const PRESETS: { id: PresetId; label: string; days: number | null }[] = [
  { id: 'week', label: 'Last week', days: 7 },
  { id: 'fortnight', label: 'Last 2 weeks', days: 14 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: '60d', label: 'Last 60 days', days: 60 },
  { id: '90d', label: 'Last 90 days', days: 90 },
  { id: 'all', label: 'All time', days: null },
]

/** `day` shifted by `delta` calendar days (UTC, so daylight saving cannot interfere). */
export function addDays(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10)
}

/**
 * The range a preset stands for: its last `days` days ending on the latest day with data,
 * never starting before the first day with data. "All time" has no bounds.
 */
export function resolvePreset(id: PresetId, first: string, last: string): DayRange {
  const days = PRESETS.find((p) => p.id === id)?.days
  if (!days) return {}
  const start = addDays(last, -(days - 1))
  return { from: start < first ? first : start, to: last }
}

/**
 * Which preset the current range is, if any. A range without bounds is "All time". Otherwise
 * the shortest preset that resolves to exactly these days wins (with very little data several
 * presets coincide); anything else is a custom range.
 */
export function matchPreset(range: DayRange, first?: string, last?: string): PresetId | undefined {
  if (!range.from && !range.to) return 'all'
  if (!first || !last) return undefined
  return PRESETS.find((p) => {
    if (p.id === 'all') return false
    const r = resolvePreset(p.id, first, last)
    return r.from === range.from && r.to === range.to
  })?.id
}

/** What to restore on load from the saved choice: only presets are rolling and worth keeping. */
export function restoreRange(saved: string | null, first?: string | null, last?: string | null): DayRange | undefined {
  const preset = PRESETS.find((p) => p.id === saved)
  if (!preset || preset.id === 'all' || !first || !last) return undefined
  return resolvePreset(preset.id, first, last)
}

// ---- diagnostic-tool reports ----

/**
 * The report to show: the one asked for in the address, else the newest (the list is newest
 * first). `notFound` is true when something was asked for that does not exist.
 */
export function pickReport<T extends { report_id: string }>(
  list: T[],
  requested: string | null | undefined,
): { report: T | undefined; notFound: boolean } {
  if (list.length === 0) return { report: undefined, notFound: false }
  const found = requested ? list.find((r) => r.report_id === requested) : undefined
  return { report: found ?? list[0], notFound: Boolean(requested) && !found }
}

/** "15 Oct 2026, 09:56 · 5,781 km · file name": how a report is named in lists. */
export function reportLabel(r: { taken_at?: string | null; odometer_km?: number | null; source_file: string }): string {
  const when = r.taken_at
    ? new Date(r.taken_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'unknown date'
  return `${when} · ${fmtNum(r.odometer_km, 0, 'km')} · ${r.source_file}`
}
