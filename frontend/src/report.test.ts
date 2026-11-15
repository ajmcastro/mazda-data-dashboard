import { afterEach, describe, expect, it } from 'vitest'
import { REPORT_FOOTER, SECTION_IDS, SECTION_TITLE, buildReport, isEmpty, periodText, type ReportInput, type SectionId } from './report'
import { fmtDate, fmtNum } from './lib'
import { DEFAULT_UNITS, setUnits } from './units'

afterEach(() => setUnits(DEFAULT_UNITS))

const VIN = 'SAMPLEVIN00000001'
const fault = (over = {}) => ({
  ecu: 'ECM', ecu_title: 'Engine', dtc_code: 'P0562', failure_type: '16', title: 'System voltage low', severity: 'warning', readouts: 3,
  first_seen: '2026-05-02T10:00:00Z', last_seen: '2026-06-20T10:00:00Z', active_in_latest_readout: true, ...over,
})
const full = (over: Partial<ReportInput> = {}): ReportInput => ({
  car: { id: 'cx5', name: 'Mazda CX-5' }, period: { from: '2026-05-01', to: '2026-06-30' }, showVin: false,
  overview: {
    vin: VIN, odometer_km: 4879.3, odometer_at: '2026-06-30T19:01:00Z', km_in_range: 2535, l_per_100km_in_range: 7.04,
    data_from: '2026-03-01T00:00:00Z', data_to: '2026-06-30T19:01:00Z',
    status: { tire_fl_kpa: 245, tire_fr_kpa: 235, tire_rl_kpa: 180, tire_rr_kpa: 245 },
  } as never,
  faults: [fault({ dtc_code: 'U2701', ecu: 'BCM', ecu_title: null, failure_type: null, title: 'no description yet', active_in_latest_readout: false, last_seen: '2026-05-10T10:00:00Z' }), fault()] as never,
  carWarnings: {
    has_data: true, all_clear: false,
    flags: [{ flag: 'rl', label: 'tire pressure, rear left', is_on: true, since: '2026-06-20T12:21:00Z' }, { flag: 'oil', label: 'oil level', is_on: false }],
    episodes: [{ flag: 'rl', label: 'tire pressure, rear left', started_at: '2026-06-20T12:21:00Z', last_on_at: '2026-06-30T19:01:00Z', readings: 14, max_value: 1, ongoing: true }],
  } as never,
  lamps: {
    has_data: true,
    flags: [
      { flag: 'vdt_2_warningpt_1_23', title: null, readings: 195, readings_on: 6, first_on_at: '2026-04-15T08:00:00Z', last_on_at: '2026-06-30T19:01:00Z', on_now: true },
      { flag: 'vdt_2_warningpt_1_24', title: null, readings: 195, readings_on: 0, on_now: false },
    ],
    episodes: [],
  } as never,
  tireForecast: {
    limit_kpa: 200, window_days: 30, min_measurements: 8, min_span_days: 10,
    wheels: [{ wheel: 'rl', measurements: 47, span_days: 29.4, current_kpa: 180, enough: true, kpa_per_week: -15.1, losing: true, below_limit: true }],
  } as never,
  forecast: { has_data: true, as_of: '2026-06-30', oil_left_km: 1000, oil_date_first: '2026-07-25', oil_date_last: '2026-07-30', km_per_day_30d: 33.9, km_per_day_90d: 41 } as never,
  diagnostics: [
    { report_id: 'a', taken_at: '2026-05-20T09:00:00Z', odometer_km: 3231, monitors_total: 8, monitors_passed: 6, dtcs_listed: 1 },
    { report_id: 'b', taken_at: '2026-06-30T09:00:00Z', odometer_km: 4859, monitors_total: 8, monitors_passed: 8, dtcs_listed: 2 },
  ] as never,
  service: { kinds: [], entries: [{ date: '2026-04-10', kind: 'software', note: 'Infotainment update', odometer_km: null }], suggestions: [] },
  alerts: [{ alert_id: 1, rule: 'low_tire_pressure', severity: 'warning', title: 'Low tire pressure (rear left): 190 kPa', detail: 'below your limit', occurred_at: '2026-06-27T11:20:00Z', created_at: '2026-07-01T00:00:00Z', status: 'new' }] as never,
  ...over,
})
const section = (input: ReportInput, id: SectionId) => buildReport(input).find((s) => s.id === id)
const text = (input: ReportInput) => JSON.stringify(buildReport(input))

describe('the sections', () => {
  it('come in a fixed order, each with a title', () => {
    expect(buildReport(full()).map((s) => s.id)).toEqual([...SECTION_IDS])
    for (const id of SECTION_IDS) expect(SECTION_TITLE[id]).toBeTruthy()
  })
  it('leave out what is unticked and what the car has nothing for', () => {
    expect(buildReport(full(), new Set<SectionId>(['car', 'faults'])).map((s) => s.id)).toEqual(['car', 'faults'])
    const bare = full({ carWarnings: { has_data: false } as never, lamps: undefined, diagnostics: [], service: undefined, tireForecast: undefined, overview: undefined })
    expect(buildReport(bare).map((s) => s.id)).toEqual(['car', 'faults', 'alerts'])
  })
  it('say so when a section that is always there has nothing', () => {
    const none = full({ faults: [], alerts: [] })
    expect(section(none, 'faults')).toMatchObject({ lines: [], empty: 'No fault in the period and none in the latest read-out.' })
    expect(isEmpty(section(none, 'faults')!)).toBe(true)
    expect(section(none, 'alerts')!.empty).toBe('No open alert.')
    expect(isEmpty(section(full(), 'faults')!)).toBe(false)
  })
})

describe('the car', () => {
  it('shows the VIN only when asked to', () => {
    expect(text(full())).not.toContain(VIN)
    expect(text(full())).not.toContain(VIN.slice(-6))
    expect(section(full({ showVin: true }), 'car')!.lines).toContain(`VIN ${VIN}.`)
  })
  it('names the period, the odometer and the oil change ahead', () => {
    const lines = section(full(), 'car')!.lines
    expect(lines[0]).toBe(`Mazda CX-5. Period of this report: ${fmtDate('2026-05-01')} to ${fmtDate('2026-06-30')}.`)
    expect(lines).toContain(`Odometer ${fmtNum(4879)} km on ${fmtDate('2026-06-30T19:01:00Z')}.`)
    expect(lines).toContain(`${fmtNum(2535)} km driven in the period, 7.0 l/100 km on average.`)
    expect(lines.at(-1)).toMatch(/^Oil change between .* at your recent pace/)
    expect(periodText({}, full().overview)).toBe(`all the data, ${fmtDate('2026-03-01T00:00:00Z')} to ${fmtDate('2026-06-30T19:01:00Z')}`)
    expect(periodText({ from: '2026-05-01' }, undefined)).toBe(`from ${fmtDate('2026-05-01')}`)
    expect(periodText({}, undefined)).toBe('all the data')
  })
  it('follows the reader\'s units', () => {
    setUnits({ pressure: 'psi', consumption: 'mpg-uk', distance: 'mi' })
    const all = text(full())
    expect(all).toContain(`Odometer ${fmtNum(3032)} mi`)
    expect(all).toContain('rear left 26.1 psi')
  })
})

describe('faults and flags', () => {
  it('lists the faults of the latest read-out first, with what the owner noted', () => {
    const s = section(full(), 'faults')!
    expect(s.lines[0]).toBe('1 fault is listed in the latest read-out; 2 seen in the period or still listed.')
    expect(s.table!.rows.map((r) => r[0])).toEqual(['P0562:16', 'U2701'])
    expect(s.table!.rows[0].slice(1, 5)).toEqual(['ECM (Engine)', 'System voltage low', 'listed', '3'])
    expect(s.table!.rows[1].slice(1, 4)).toEqual(['BCM', 'no description yet', 'not listed'])
    expect(s.faults).toEqual([{ ecu: 'ECM', dtc_code: 'P0562' }, { ecu: 'BCM', dtc_code: 'U2701' }])
  })
  it('reports the car\'s own flags as "on", never as a meaning', () => {
    const s = section(full(), 'car_warnings')!
    expect(s.lines[0]).toBe(`On in the newest report: tire pressure, rear left (since ${fmtDate('2026-06-20T12:21:00Z')}).`)
    expect(s.lines[1]).toContain('only says it is not 0')
    expect(s.table!.rows[0][2]).toBe('still on')
    const clear = full({ carWarnings: { has_data: true, all_clear: true, flags: [{ flag: 'oil', label: 'oil level', is_on: false }], episodes: [] } as never })
    expect(section(clear, 'car_warnings')!.lines[0]).toBe('None of the flags the car reports is on in the newest report.')
  })
  it('lists only the lamp flags that were ever on, without inventing a meaning', () => {
    const s = section(full(), 'lamps')!
    expect(s.table!.rows).toHaveLength(1)
    expect(s.table!.rows[0].slice(0, 3)).toEqual(['vdt_2_warningpt_1_23', 'no description yet', '6 of 195 reports'])
    const quiet = full({ lamps: { has_data: true, flags: [{ flag: 'x', readings: 5, readings_on: 0 }], episodes: [] } as never })
    expect(section(quiet, 'lamps')).toMatchObject({ lines: [], empty: 'None of the warning-lamp flags was on.' })
  })
})

describe('the rest', () => {
  it('gives the tires with the forecast\'s own words', () => {
    const s = section(full(), 'tires')!
    expect(s.lines[0]).toBe('Newest pressures: front left 245 kPa, front right 235 kPa, rear left 180 kPa, rear right 245 kPa.')
    expect(s.lines[1]).toMatch(/^Rear left: losing about 15 kPa a week against the other three/)
    const steady = full({ tireForecast: { limit_kpa: 200, window_days: 30, min_measurements: 8, min_span_days: 10, wheels: [{ wheel: 'fl', enough: true, losing: false }] } as never })
    expect(section(steady, 'tires')!.lines.at(-1)).toBe('No wheel is losing pressure against the other three over the last 30 days.')
  })
  it('sets the newest diagnostic report against the one before', () => {
    const s = section(full(), 'diagnostics')!
    expect(s.lines[0]).toBe(`The newest diagnostic report is of ${fmtDate('2026-06-30T09:00:00Z')} at ${fmtNum(4859)} km: 2 stored faults listed, 8 of 8 emission monitors passed.`)
    expect(s.lines[1]).toBe(`Against the report before (${fmtDate('2026-05-20T09:00:00Z')}): stored faults 1 → 2; monitors passed 6 of 8 → 8 of 8; ${fmtNum(1628)} km driven between them.`)
    expect(section(full({ diagnostics: [full().diagnostics![1]] }), 'diagnostics')!.lines).toHaveLength(1)
  })
  it('carries the service log and the open alerts as they are', () => {
    expect(section(full(), 'service')!.table!.rows).toEqual([[fmtDate('2026-04-10'), 'software', 'Infotainment update', '—']])
    expect(section(full(), 'alerts')!.table!.rows).toEqual([[fmtDate('2026-06-27T11:20:00Z'), 'Low tire pressure (rear left): 190 kPa', 'below your limit']])
  })
  it('adds no judgement of its own and says what the report is', () => {
    const all = text(full({ alerts: [] })) + REPORT_FOOTER.join(' ')
    expect(all).not.toMatch(/\b(serious|dangerous|urgent|faulty|broken|you should|must be|needs? (to be )?(replac|repair))/i)
    expect(REPORT_FOOTER.join(' ')).toContain('it is not a diagnosis')
    expect(REPORT_FOOTER.join(' ')).toContain('Mazda does not publish them')
  })
})
