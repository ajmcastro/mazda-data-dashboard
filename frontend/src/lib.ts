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
