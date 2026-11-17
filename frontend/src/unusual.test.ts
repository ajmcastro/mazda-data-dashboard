import { afterEach, describe, expect, it } from 'vitest'
import type { UnusualReason, UnusualReport, UnusualReports } from './api/types'
import { tr } from './i18n'
import { ENGLISH_LEFT, PT_VERDICT, inPortuguese } from './i18n/testing'
import { setUnits, DEFAULT_UNITS } from './units'
import { UNUSUAL_NOTE, momentOf, moments, openParts, reasonText, standsOut, summaryLine } from './unusual'

const reason = (over: Partial<UnusualReason>): UnusualReason => ({
  feature: 'hour', value: null, label: null, share_pct: null, z: null, usual_low: null, usual_high: null, ...over,
})
const report = (at: string, local: string, reasons: UnusualReason[], kind = 'status'): UnusualReport => ({ at, kind, local, reasons })

const hour3 = reason({ feature: 'hour', value: 3, share_pct: 0.4 })
const spread = reason({ feature: 'tire_spread', value: 30, z: 4, usual_low: 0, usual_high: 10 })
const fuel = reason({ feature: 'fuel_drop_parked', value: 6, z: 6, usual_low: 0, usual_high: 0 })
const door = reason({ feature: 'open', label: 'door_driver,hazard', share_pct: 0.8 })

const answer = (reports: UnusualReport[], over: Partial<UnusualReports> = {}): UnusualReports => ({
  min_reports: 30, threshold_z: 3.5, rare_pct: 1, status_reports: 258, doors_reports: 236,
  enough_status: true, enough_doors: true, reports, ...over,
})

afterEach(() => setUnits(DEFAULT_UNITS))

describe('a reason', () => {
  it('says what was unlike the other reports, with what is usual', () => {
    expect(reasonText(fuel)).toBe('the fuel level fell 6.0 points while the odometer did not move (usually 0.0)')
    expect(reasonText(spread)).toBe('the four tire pressures were 30 kPa apart (usually 0 kPa to 10 kPa)')
    expect(reasonText(hour3)).toBe('a report between 03:00 and 03:59, an hour with 0.4% of the reports')
    expect(reasonText(door)).toBe('the driver door and the hazard lights open, as in 0.8% of the door reports')
  })

  it('follows the reader’s pressure unit', () => {
    setUnits({ ...DEFAULT_UNITS, pressure: 'bar' })
    expect(reasonText(spread)).toBe('the four tire pressures were 0.30 bar apart (usually 0.00 bar to 0.10 bar)')
  })

  it('names the open parts', () => {
    expect(openParts('trunk')).toBe('the trunk')
    expect(openParts('')).toBe('')
  })
})

describe('moments', () => {
  const reports = [
    report('2026-07-18T02:18:33Z', '2026-07-18 03:18', [hour3], 'doors'),
    report('2026-07-18T02:14:02Z', '2026-07-18 03:14', [hour3, spread]),
    report('2026-07-12T10:50:11Z', '2026-07-12 11:50', [door], 'doors'),
  ]

  it('join reports a few minutes apart, newest first, each reason once', () => {
    const m = moments(reports)
    expect(m.map((x) => x.local)).toEqual(['2026-07-18 03:14', '2026-07-12 11:50'])
    expect(m[0].reports).toEqual(['2026-07-18T02:14:02Z', '2026-07-18T02:18:33Z'])
    expect(m[0].reasons.map((r) => r.feature)).toEqual(['hour', 'tire_spread'])
  })

  it('keep reports further apart separate', () => {
    expect(moments(reports, 2)).toHaveLength(3)
    expect(moments(undefined)).toEqual([])
  })

  it('find the moment of a report by its time', () => {
    const m = moments(reports)
    expect(momentOf('2026-07-18T02:18:33.000Z', m)?.local).toBe('2026-07-18 03:14')
    expect(momentOf('2026-07-18T05:00:00Z', m)).toBeUndefined()
    expect(momentOf(null, m)).toBeUndefined()
    expect(momentOf('2026-07-18T02:25:00Z', m)).toBeUndefined()
    expect(momentOf('2026-07-18T02:25:00Z', m, 15)?.local).toBe('2026-07-18 03:14') // 6.5 minutes after the door report
  })
})

describe('an entry of the Day page', () => {
  const reports = [report('2026-07-18T02:14:02Z', '2026-07-18 03:14', [hour3])]
  it('says why a report of the same kind and time stands out', () => {
    expect(standsOut('status', '2026-07-18T02:14:02Z', reports)).toBe('stands out: a report between 03:00 and 03:59, an hour with 0.4% of the reports')
    expect(standsOut('doors', '2026-07-18T02:14:02Z', reports)).toBeNull()
    expect(standsOut('warning', '2026-07-18T02:14:02Z', reports)).toBeNull()
    expect(standsOut('status', '2026-07-18T02:15:00Z', reports)).toBeNull()
  })
})

describe('the headline', () => {
  it('counts the moments against the reports looked at', () => {
    expect(summaryLine(answer([report('2026-07-12T10:50:11Z', '2026-07-12 11:50', [door], 'doors')]))).toBe(
      '1 moment of the 494 reports of the period stands out from the car’s other reports.',
    )
    expect(summaryLine(answer([]))).toBe('None of the 494 reports of the period stands out from the car’s other reports.')
  })

  it('says when there is too little to tell, or nothing in the period', () => {
    expect(summaryLine(answer([], { enough_status: false, enough_doors: false }))).toMatch(/Too few reports/)
    expect(summaryLine(answer([], { status_reports: 0, doors_reports: 0 }))).toBe('No reports in this period.')
    expect(summaryLine(undefined)).toBeNull()
  })
})

describe('the wording stays neutral', () => {
  const all = () =>
    [
      summaryLine(answer([report('2026-07-12T10:50:11Z', '2026-07-12 11:50', [door], 'doors')])),
      ...[fuel, spread, hour3, door].map(reasonText),
      tr(UNUSUAL_NOTE, { z: 3.5, pct: 1 }),
    ].join(' ')

  it('never calls a report a fault, a problem or a risk', () => {
    expect(all()).not.toMatch(/\b(fault|problem|wrong with|broken|danger|risk|suspicious|theft|leak|bad|worse|should)\b/i)
    expect(UNUSUAL_NOTE).toMatch(/not that anything is wrong/)
  })

  it('in Portuguese too', () => {
    const pt = inPortuguese(all)
    expect(pt).not.toBe(all())
    expect(pt).not.toMatch(PT_VERDICT)
    expect(pt).not.toMatch(ENGLISH_LEFT)
  })
})
