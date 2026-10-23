import { useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSpan } from './api/hooks'
import { restoreRange, sanitizeRange, type DayRange, type PresetId } from './lib'

/**
 * The selected period lives in the address (`?from=2026-06-12&to=2026-07-12`) so that a view can
 * be bookmarked and survives reloads and navigation. Missing bounds mean "no limit".
 */
export function useDateRange() {
  const [params, setParams] = useSearchParams()
  const from = params.get('from')
  const to = params.get('to')
  const range = useMemo(() => sanitizeRange(from, to), [from, to])

  const setRange = (next: DayRange) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        for (const key of ['from', 'to'] as const) {
          if (next[key]) p.set(key, next[key])
          else p.delete(key)
        }
        return p
      },
      { replace: true },
    )

  return { ...range, isFiltered: Boolean(range.from || range.to), setRange, clear: () => setRange({}) }
}

/** `?from=…&to=…` for the current period, to carry it over when linking to another page. */
export function useRangeSearch(): string {
  const { from, to } = useDateRange()
  const p = new URLSearchParams()
  if (from) p.set('from', from)
  if (to) p.set('to', to)
  const s = p.toString()
  return s ? `?${s}` : ''
}

const STORAGE_KEY = 'cx5.range'

/** The last choice: a preset id, or 'custom' for typed dates (dates would be stale next time). */
export function saveRangeChoice(choice: PresetId | 'custom'): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    /* storage can be blocked (private window); the app works without it */
  }
}

function loadRangeChoice(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * On the first load without a period in the address, bring back the last preset the user chose
 * (counted from the newest data, so "Last 30 days" still means the newest 30 days after a new
 * export). Runs once, so choosing "All time" afterwards is not undone.
 */
export function useRestoreSavedRange() {
  const { isFiltered, setRange } = useDateRange()
  const span = useSpan().data
  const done = useRef(false)

  useEffect(() => {
    if (done.current || !span) return
    done.current = true
    if (isFiltered) return // a shared or bookmarked address wins over the saved choice
    const restored = restoreRange(loadRangeChoice(), span.first_day, span.last_day)
    if (restored) setRange(restored)
  }, [span, isFiltered, setRange])
}
