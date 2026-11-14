import { afterEach, describe, expect, it } from 'vitest'
import type { ServiceEntry, ServiceSuggestion } from './api/types'
import { fmtDate, fmtNum } from './lib'
import { EMPTY_DRAFT, draftFrom, extent, kindLabel, markerTime, markers, problems, suggestionText, toEntry, yamlLine } from './service'
import { DEFAULT_UNITS, setUnits } from './units'

afterEach(() => setUnits(DEFAULT_UNITS))

const KINDS = ['oil_change', 'tires', 'service', 'software', 'repair', 'other']
const oil: ServiceSuggestion = { kind: 'oil_change', reason: 'oil_countdown', date: '2026-09-14', odometer_km: 4310.4 }
const visit: ServiceSuggestion = { kind: 'service', reason: 'diagnostic_report', date: '2026-10-15', odometer_km: null }

describe('suggestions', () => {
  it('say what was seen and that it only looks like something', () => {
    expect(suggestionText(oil)).toBe(`The oil countdown went up on ${fmtDate('2026-09-14')} at ${fmtNum(4310)} km: it looks like an oil change by then.`)
    expect(suggestionText(visit)).toBe(`A diagnostic report was taken on ${fmtDate('2026-10-15')}: it looks like a visit to a workshop.`)
    expect(suggestionText({ ...visit, reason: 'new' })).toContain('it may be worth noting')
    setUnits({ ...DEFAULT_UNITS, distance: 'mi' })
    expect(suggestionText(oil)).toContain(`${fmtNum(2678)} mi`)
  })
  it('start an entry but leave the note to the owner', () => {
    expect(draftFrom(oil)).toEqual({ date: '2026-09-14', kind: 'oil_change', note: '', odometer: '4310' })
    expect(draftFrom(visit).odometer).toBe('')
    expect(problems(draftFrom(oil), KINDS)).toEqual(['Write a short note of what was done.'])
  })
})

describe('a draft', () => {
  const good = { date: '2026-09-14', kind: 'tires', note: ' Winter tires ', odometer: '5120' }
  it('is sent trimmed, the odometer as a number or not at all', () => {
    expect(problems(good, KINDS)).toEqual([])
    expect(toEntry(good)).toEqual({ date: '2026-09-14', kind: 'tires', note: 'Winter tires', odometer_km: 5120 })
    expect(toEntry({ ...good, odometer: ' ' }).odometer_km).toBeNull()
  })
  it('names each thing that is wrong', () => {
    expect(problems(EMPTY_DRAFT, KINDS)).toEqual(['Pick the day it was done.', 'Write a short note of what was done.'])
    expect(problems({ ...good, kind: 'wash' }, KINDS)).toEqual(['Pick what kind of work it was.'])
    expect(problems({ ...good, date: '2026-13-40' }, KINDS)).toEqual(['Pick the day it was done.'])
    expect(problems({ ...good, note: 'x'.repeat(201) }, KINDS)).toEqual(['The note is too long (200 characters at most).'])
    expect(problems({ ...good, odometer: 'far' }, KINDS)).toEqual(['The odometer must be a number of kilometres, or left empty.'])
    expect(problems({ ...good, odometer: '-5' }, KINDS)).toHaveLength(1)
  })
})

describe('the line to paste', () => {
  it('is the form the dashboard writes', () => {
    expect(yamlLine({ date: '2026-09-14', kind: 'oil_change', note: 'Oil and filter', odometer_km: 4310 })).toBe(
      '- {date: 2026-09-14, kind: oil_change, note: "Oil and filter", odometer_km: 4310}',
    )
    expect(yamlLine({ date: '2026-10-02', kind: 'tires', note: 'Winter: "all four"', odometer_km: null })).toBe(
      '- {date: 2026-10-02, kind: tires, note: "Winter: \\"all four\\""}',
    )
    expect(yamlLine({ date: '2026-10-02', kind: 'service', note: '', odometer_km: null })).toContain('note: "…"')
  })
  it('has a name for every kind', () => {
    for (const k of KINDS) expect(kindLabel(k)).not.toBe('')
    expect(kindLabel('oil_change')).toBe('oil change')
    expect(kindLabel('new_kind')).toBe('new_kind')
  })
})

describe('marks on a time chart', () => {
  const entries: ServiceEntry[] = [
    { date: '2026-10-02', kind: 'tires', note: 'Winter tires', odometer_km: null },
    { date: '2026-09-14', kind: 'oil_change', note: 'Oil and filter', odometer_km: 4310 },
    { date: '2025-01-01', kind: 'repair', note: 'before the data', odometer_km: null },
  ]
  it('are the entries inside the chart, in time order, at noon of their day', () => {
    const [from, to] = [Date.parse('2026-09-01T00:00:00'), Date.parse('2026-10-31T00:00:00')]
    const got = markers(entries, from, to)
    expect(got.map((m) => m.label)).toEqual(['oil change', 'tires'])
    expect(got[0].t).toBe(markerTime('2026-09-14'))
    expect(new Date(got[0].t).getHours()).toBe(12)
    expect(got[0].title).toBe(`${fmtDate('2026-09-14')}: Oil and filter`)
  })
  it('are none without entries or without a chart', () => {
    expect(markers(undefined, 0, 1)).toEqual([])
    expect(markers(entries, undefined, undefined)).toEqual([])
    expect(extent([])).toEqual([undefined, undefined])
    expect(extent([{ t: 5 }, { t: 2 }, { t: 9 }])).toEqual([2, 9])
    expect(extent(undefined)).toEqual([undefined, undefined])
  })
})
