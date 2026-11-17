import { describe, expect, it } from 'vitest'
import type { Comeback, FaultComeback } from './api/types'
import { COMEBACK_NOTE, comebackOf, estimateLine, historyLine, nowLine, reportLine, serviceBefore, waitsLine } from './comeback'
import { tr } from './i18n'
import { ENGLISH_LEFT, PT_VERDICT, inPortuguese } from './i18n/testing'

const fault = (over: Partial<FaultComeback> = {}): FaultComeback => ({
  ecu: 'BCM', dtc_code: 'U0198', title: null, readouts: 43, listed: 30,
  first_at: '2026-06-13T08:45:48Z', last_listed_at: '2026-11-01T10:00:00Z', last_read_at: '2026-11-10T17:45:46Z',
  listed_now: false,
  waits: [
    { from_at: '2026-07-08T10:00:00Z', to_at: '2026-08-26T17:00:00Z', days: 49.3, back: true },
    { from_at: '2026-09-02T10:00:00Z', to_at: '2026-09-11T08:00:00Z', days: 8.9, back: true },
    { from_at: '2026-11-10T17:45:46Z', to_at: null, days: 0, back: false },
  ],
  ended: 2, enough: false, still_away: [], median_days: null, ...over,
})
const flapping = fault({
  ecu: 'EPS', dtc_code: 'C1452', listed: 5, readouts: 16, listed_now: false,
  waits: [
    { from_at: '2026-04-21T10:00:00Z', to_at: '2026-04-28T10:00:00Z', days: 7, back: true },
    { from_at: '2026-05-05T10:00:00Z', to_at: '2026-06-02T08:00:00Z', days: 27.9, back: true },
    { from_at: '2026-06-09T10:00:00Z', to_at: '2026-06-30T10:00:00Z', days: 21, back: true },
    { from_at: '2026-07-14T10:00:00Z', to_at: null, days: 7, back: false },
  ],
  ended: 3, enough: true,
  still_away: [{ days: 7, pct: 66.7 }, { days: 30, pct: 0 }, { days: 90, pct: 0 }], median_days: 21,
})

describe('one fault', () => {
  it('has its history and whether the newest read-out lists it', () => {
    expect(historyLine(fault())).toBe("Listed in 30 of the unit's 43 read-outs, from 13 Jun 2026 to 01 Nov 2026.")
    expect(nowLine(fault())).toBe('Not listed in the unit’s newest read-out (10 Nov 2026).')
    expect(nowLine(fault({ listed_now: true }))).toBe('Listed in the unit’s newest read-out (10 Nov 2026).')
  })

  it('says when it stopped being listed and when it was listed again', () => {
    expect(waitsLine(fault())).toBe('It stopped being listed 3 times and was listed again 2 times: 49 days and 9 days later.')
    expect(waitsLine(flapping)).toBe('It stopped being listed 4 times and was listed again 3 times: 7 days, 28 days and 21 days later. Not listed again in the 7 days since it last stopped.')
    expect(waitsLine(fault({ waits: [] }))).toBe('It has never stopped being listed.')
    expect(waitsLine(fault({ waits: [{ from_at: '2026-07-11T10:00:00Z', to_at: null, days: 121.4, back: false }] }))).toBe(
      'It stopped being listed once and has not been listed again.',
    )
    expect(waitsLine(fault({ waits: fault().waits.slice(0, 2) }))).toBe('It stopped being listed 2 times and was listed again every time: 49 days and 9 days later.')
  })

  it('gives the estimate only with enough returns', () => {
    expect(estimateLine(fault(), 3)).toBe('Too few returns for an estimate (it needs 3).')
    expect(estimateLine(flapping, 3)).toBe('Still not listed again: 67% after 7 days, 0% after 30 days and 0% after 90 days. Half were listed again within 21 days.')
  })

  it('names a service-log entry in the week before a wait started', () => {
    const entries = [
      { date: '2026-07-06', kind: 'dealer', note: '', odometer_km: null },
      { date: '2026-05-01', kind: 'oil', note: '', odometer_km: null },
    ]
    expect(serviceBefore('2026-07-08T10:00:00Z', entries)).toMatch(/^after the service log’s .+ of 06 Jul 2026$/)
    expect(serviceBefore('2026-09-02T10:00:00Z', entries)).toBeNull()
    expect(serviceBefore('2026-09-02T10:00:00Z', undefined)).toBeNull()
  })

  it('is found by unit and code', () => {
    const c: Comeback = { min_ended: 3, faults: [fault(), flapping] }
    expect(comebackOf(c, 'EPS', 'C1452')?.listed).toBe(5)
    expect(comebackOf(c, 'EPS', 'U0198')).toBeUndefined()
    expect(comebackOf(undefined, 'BCM', 'U0198')).toBeUndefined()
  })
})

describe('the workshop report', () => {
  it('has one short line per fault', () => {
    expect(reportLine(fault(), 3)).toBe('listed in 30 of 43 read-outs; stopped 3 times, listed again after 49 days and 9 days; too few returns for an estimate (it needs 3)')
    expect(reportLine(flapping, 3)).toBe('listed in 5 of 16 read-outs; stopped 4 times, listed again after 7 days, 28 days and 21 days; half back within 21 days')
    expect(reportLine(fault({ waits: [], listed: 3, readouts: 3 }), 3)).toBe('listed in 3 of 3 read-outs')
    expect(reportLine(fault({ waits: [{ from_at: '2026-10-03T10:00:00Z', to_at: null, days: 38, back: false }], listed: 17, readouts: 47 }), 3)).toBe(
      'listed in 17 of 47 read-outs; stopped once, not listed again',
    )
  })
})

describe('the wording stays neutral', () => {
  const all = () => [historyLine(fault()), nowLine(fault()), waitsLine(fault()), estimateLine(flapping, 3), reportLine(flapping, 3), tr(COMEBACK_NOTE)].join(' ')

  it('never says a repair worked or failed, or what caused it', () => {
    expect(all()).not.toMatch(/\b(fixed|repaired|failed|caused|causes|because|due to|bad|good|worse|better|should)\b/i)
    expect(COMEBACK_NOTE).toMatch(/not a cause or whether a repair worked/)
  })

  it('in Portuguese too', () => {
    const pt = inPortuguese(all)
    expect(pt).not.toBe(all())
    expect(pt).not.toMatch(PT_VERDICT)
    expect(pt).not.toMatch(ENGLISH_LEFT)
  })
})
