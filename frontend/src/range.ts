import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { sanitizeRange, type DayRange } from './lib'

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
