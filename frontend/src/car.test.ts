import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CarWarningFlag, CarWarnings, DoorPoint, LatestStatus, OilService, Overview, StatusPoint, TireReading } from './api/types'
import { fmtNum } from './lib'
import { ALERT_PART, CAR_NOTES, SCRUB_NOTE, carStateAt, reportText, alertCounts, alertPart, alertsText, carHeadline, partName, carState, carView, parseCarView, listedParts, stateBadge, type CarState, type PartId } from './car'

const AT = '2026-07-01T08:00:00Z'

const overview = (status: Partial<LatestStatus> = {}, over: Partial<Overview> = {}): Overview => ({
  odometer_km: 41250, odometer_at: AT, has_data_in_range: true,
  warnings_total: 0, warnings_in_range: 0, active_faults: 0, faults_seen: 0, unmapped_codes: 0, alerts_new: 0,
  status: {
    at: AT, fuel_level_pct: 62, range_km: 410,
    tire_fl_kpa: 240, tire_fr_kpa: 238, tire_rl_kpa: 235, tire_rr_kpa: 236,
    tire_measured_at: '2026-07-01T07:50:00Z', tire_age_minutes: 10, tire_stale: false,
    ...status,
  },
  ...over,
})

const door = (over: Partial<DoorPoint> = {}): DoorPoint => ({
  created_at: AT, door_driver: 0, door_passenger: 0, door_rear_left: 0, door_rear_right: 0, trunk: 0, hood: 0,
  lock_driver: 2, lock_passenger: 2, hazard_switch: 0, light_switch: 0, invalid_signals: 0,
  ...over,
})

const oil = (over: Partial<OilService> = {}): OilService => ({
  has_data: true, remaining_km: 6000, read_at: AT, odometer_km: 41000, km_since_reading: 250, intervals: 1, steps: [],
  ...over,
})

const flag = (name: string, is_on: boolean, label = name): CarWarningFlag => ({
  flag: name, label, is_on, value: is_on ? 1 : 0, last_read_at: AT, readings: 10, episodes: is_on ? 1 : 0,
  since: is_on ? AT : null,
})

const warnings = (...flags: CarWarningFlag[]): CarWarnings => ({
  has_data: flags.length > 0, all_clear: !flags.some((f) => f.is_on), flags, episodes: [],
})

const part = (car: CarState, id: PartId) => car.parts.find((p) => p.id === id)!

describe('carState', () => {
  it('lists every part once, in a fixed order', () => {
    const ids = carState(overview(), door(), oil(), warnings()).parts.map((p) => p.id)
    expect(ids).toEqual([
      'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr',
      'door_driver', 'door_passenger', 'door_rear_left', 'door_rear_right', 'trunk', 'hood',
      'fuel', 'engine', 'dash',
    ])
    expect(carState(undefined, undefined, undefined, undefined).parts.map((p) => p.id)).toEqual(ids)
  })

  it('has nothing to remark on a healthy car', () => {
    const car = carState(overview(), door(), oil(), warnings(flag('fltyrepresswarn', false)))
    expect(car.parts.every((p) => p.state === 'ok')).toBe(true)
    expect(car.hasData).toBe(true)
    expect(car.asOf).toBe(AT)
    expect(carHeadline(car)).toBe('Nothing to remark in the latest reports.')
    expect(car.parts.every((p) => stateBadge(p) === null)).toBe(true)
  })

  it('is empty, not an error, without any answer', () => {
    const car = carState(undefined, undefined, undefined, undefined)
    expect(car.hasData).toBe(false)
    expect(car.parts.every((p) => p.state === 'absent')).toBe(true)
    expect(carHeadline(car)).toBe('No status report in this period.')
    expect(listedParts(car, 'wheels')).toEqual([])
  })

  it('is empty for an empty period (an overview with no status and no odometer)', () => {
    const none = overview(
      { at: null, fuel_level_pct: null, range_km: null, tire_fl_kpa: null, tire_fr_kpa: null, tire_rl_kpa: null, tire_rr_kpa: null, tire_measured_at: null },
      { odometer_km: null, odometer_at: null },
    )
    expect(carState(none, undefined, { has_data: false, intervals: 0, steps: [] }, warnings()).hasData).toBe(false)
  })
})

describe('wheels', () => {
  it('show the pressure and when it was measured', () => {
    const w = part(carState(overview(), door(), oil(), warnings()), 'wheel_fl')
    expect(w.value).toBe(fmtNum(240, 0, 'kPa'))
    expect(w.state).toBe('ok')
    expect(w.old).toBe(false)
    expect(w.notes[0]).toMatch(/^measured /)
    expect(w.at).toBe('2026-07-01T07:50:00Z')
  })

  it('mark the wheel whose own flag is on, and only that one', () => {
    const car = carState(overview(), door(), oil(), warnings(flag('rltyrepresswarn', true), flag('rrtyrepresswarn', false)))
    expect(part(car, 'wheel_rl').state).toBe('attention')
    expect(part(car, 'wheel_rl').notes[0]).toContain('tire flag is on')
    expect(part(car, 'wheel_rr').state).toBe('ok')
    expect(stateBadge(part(car, 'wheel_rl'))?.text).toBe('check')
  })

  it('mark the clearly lowest wheel, by the rule of the tire drawing (20 kPa under the highest)', () => {
    const low = carState(overview({ tire_rl_kpa: 215 }), door(), oil(), warnings())
    expect(part(low, 'wheel_rl').state).toBe('attention')
    expect(part(low, 'wheel_rl').notes[0]).toBe('lowest of the four, 25 kPa under the highest')
    expect(part(low, 'wheel_fl').state).toBe('ok')
    const close = carState(overview({ tire_rl_kpa: 221 }), door(), oil(), warnings())
    expect(part(close, 'wheel_rl').state).toBe('ok')
  })

  it('say when the reading is an old one the car kept showing', () => {
    const car = carState(overview({ tire_stale: true, tire_age_minutes: 600 }), door(), oil(), warnings())
    const w = part(car, 'wheel_fr')
    expect(w.old).toBe(true)
    expect(w.state).toBe('ok')
    expect(w.notes[0]).toMatch(/^old reading: measured .* 10 h 00 min before this snapshot$/)
    expect(stateBadge(w)).toEqual({ kind: 'warning', text: 'old reading' })
  })

  it('keep a missing pressure unknown, never zero', () => {
    const car = carState(overview({ tire_fr_kpa: null }), door(), oil(), warnings())
    expect(part(car, 'wheel_fr')).toMatchObject({ state: 'unknown', value: 'unknown', old: false })
    // the three that are known are not compared with a made-up zero
    expect(part(car, 'wheel_rl').state).toBe('ok')
  })

  it('say the measurement time is unknown when the car sent none', () => {
    const car = carState(overview({ tire_measured_at: null, tire_age_minutes: null, tire_stale: null }), door(), oil(), warnings())
    expect(part(car, 'wheel_fl').notes).toEqual(['measurement time unknown'])
    expect(part(car, 'wheel_fl').at).toBe(AT)
  })

  it('are absent for a car that sends neither pressures nor tire flags', () => {
    const none = overview({ tire_fl_kpa: null, tire_fr_kpa: null, tire_rl_kpa: null, tire_rr_kpa: null })
    const car = carState(none, door(), oil(), warnings())
    expect(listedParts(car, 'wheels')).toEqual([])
    expect(car.hasData).toBe(true)
  })
})

describe('doors', () => {
  it('are closed at 0 and open at any other value, with the raw value', () => {
    const car = carState(overview(), door({ door_driver: 1, trunk: 3 }), oil(), warnings())
    expect(part(car, 'door_driver')).toMatchObject({ state: 'open', value: 'open (raw 1)' })
    expect(part(car, 'trunk')).toMatchObject({ state: 'open', value: 'open (raw 3)' })
    expect(part(car, 'hood')).toMatchObject({ state: 'ok', value: 'closed' })
    expect(carHeadline(car)).toBe('Open: driver door, trunk.')
  })

  it('stay unknown when the car flagged the value Invalid (null), never closed', () => {
    const car = carState(overview(), door({ door_driver: null }), oil(), warnings())
    expect(part(car, 'door_driver')).toMatchObject({ state: 'unknown', value: 'unknown' })
    expect(stateBadge(part(car, 'door_driver'))).toBeNull() // the value already says it
    expect(carHeadline(car)).toBe('Unknown: driver door.')
  })

  it('carry the lock codes raw, on the two doors that have one', () => {
    const car = carState(overview(), door({ lock_driver: 3, lock_passenger: null }), oil(), warnings())
    expect(part(car, 'door_driver').notes).toEqual(['lock code 3'])
    expect(part(car, 'door_passenger').notes).toEqual([])
    expect(part(car, 'door_rear_left').notes).toEqual([])
  })

  it('are absent without a door snapshot', () => {
    expect(listedParts(carState(overview(), undefined, oil(), warnings()), 'doors')).toEqual([])
  })
})

describe('fuel, engine and dashboard', () => {
  it('show the fuel level with the range', () => {
    const f = part(carState(overview(), door(), oil(), warnings()), 'fuel')
    expect(f).toMatchObject({ state: 'ok', value: '62 %', notes: [`range ${fmtNum(410, 0, 'km')}`], at: AT })
  })

  it('show the car\'s own oil countdown', () => {
    const e = part(carState(overview(), door(), oil(), warnings()), 'engine')
    expect(e.value).toBe('6,000 km to oil change')
    expect(e.state).toBe('ok')
    expect(e.notes).toEqual(["the car's own countdown, in steps of 1,000 km or more", '250 km driven since'])
  })

  it('mark an oil change that is due soon, and the oil level flag', () => {
    const soon = part(carState(overview(), door(), oil({ remaining_km: 1000 }), warnings()), 'engine')
    expect(soon.state).toBe('attention')
    expect(soon.notes[0]).toBe('oil change due soon')
    const level = part(carState(overview(), door(), oil(), warnings(flag('oillevelwarning', true))), 'engine')
    expect(level.state).toBe('attention')
    expect(level.notes[0]).toContain('oil level flag is on')
  })

  it('has no engine entry for a car that sends neither the countdown nor the oil flag', () => {
    const car = carState(overview(), door(), { has_data: false, intervals: 0, steps: [] }, warnings())
    expect(part(car, 'engine').state).toBe('absent')
    expect(listedParts(car, 'other').map((p) => p.id)).toEqual(['fuel', 'dash'])
  })

  it('shows the oil flag alone for a car without the countdown', () => {
    const car = carState(overview(), door(), { has_data: false, intervals: 0, steps: [] }, warnings(flag('oillevelwarning', false)))
    expect(part(car, 'engine')).toMatchObject({ state: 'ok', value: 'oil level flag clear' })
  })

  it('shows the odometer, and the flags that belong to no single part', () => {
    const car = carState(
      overview(), door(), oil(),
      warnings(flag('seatbeltwrndrq', true, 'Seat belt warning'), flag('tpmssystemflt', false), flag('fltyrepresswarn', true)),
    )
    const d = part(car, 'dash')
    expect(d.value).toBe(fmtNum(41250, 0, 'km'))
    expect(d.state).toBe('attention')
    expect(d.notes).toEqual(['flag on: Seat belt warning (raw 1)']) // the wheel's flag is on the wheel, not here
    expect(carHeadline(car)).toBe('To check: front left wheel, dashboard.')
  })

  it('ignores the flags when the car sends none', () => {
    const car = carState(overview(), door(), oil(), { has_data: false, all_clear: true, flags: [flag('seatbeltwrndrq', true)], episodes: [] })
    expect(part(car, 'dash').state).toBe('ok')
  })
})

describe('wording', () => {
  it('states the assumptions and never a verdict about a lock', () => {
    expect(CAR_NOTES.join(' ')).toContain('assumed to mean closed')
    expect(CAR_NOTES.join(' ')).toContain('not documented')
    const all = carState(overview(), door(), oil(), warnings()).parts.flatMap((p) => [p.value, ...p.notes]).join(' ')
    expect(all).not.toMatch(/\b(locked|unlocked)\b/i)
  })
})

describe('how the panel is shown', () => {
  it('remembers only the list; anything else is the 3D view', () => {
    expect(parseCarView('list')).toBe('list')
    for (const v of ['3d', null, undefined, '', 'LIST', 7]) expect(parseCarView(v)).toBe('3d')
  })
  it('falls back to the list when the 3D view failed', () => {
    expect(carView('3d', null)).toBe('3d')
    expect(carView('3d', 'no WebGL')).toBe('list')
    expect(carView('list', null)).toBe('list')
  })
})

describe('alerts on the car (M55)', () => {
  const a = (rule: string, dedup_key: string) => ({ rule, dedup_key })
  it('puts each alert on the part its rule and key are about, never by its text', () => {
    expect(alertPart(a('low_tire_pressure', 'low_tire_pressure:rear left:2026-06-27'))).toBe('wheel_rl')
    expect(alertPart(a('low_tire_pressure', 'low_tire_pressure:front right:2026-06-27'))).toBe('wheel_fr')
    expect(alertPart(a('tire_leak_forecast', 'tire_leak_forecast:fl:00010101T000000'))).toBe('wheel_fl')
    expect(alertPart(a('car_warning_flag', 'car_warning_flag:rrtyrepresswarn:20260620T112100'))).toBe('wheel_rr')
    expect(alertPart(a('car_warning_flag', 'car_warning_flag:oillevelwarning:20260620T112100'))).toBe('engine')
    expect(alertPart(a('car_warning_flag', 'car_warning_flag:dropnwrn:20260620T112100'))).toBe('dash') // which door is not said
    expect(alertPart(a('car_warning_flag', 'car_warning_flag:tpmssystemflt:20260620T112100'))).toBe('dash')
    expect(alertPart(a('oil_change_due', 'oil_change_due:20260301T000000'))).toBe('engine')
    expect(alertPart(a('low_fuel', 'low_fuel:2026-06-01'))).toBe('fuel')
    expect(alertPart(a('new_dtc', 'new_dtc:BCM:U0198:00'))).toBe('dash')
    expect(alertPart(a('data_gap', 'data_gap:2026-10-15'))).toBeNull()
    expect(alertPart(a('a_rule_of_tomorrow', 'x'))).toBeNull()
    expect(alertPart({ rule: 'low_tire_pressure' })).toBe('dash') // an alert without its key still shows somewhere
  })
  it('has a part, or a deliberate none, for every rule the backend has', () => {
    const source = readFileSync(new URL('../../backend/src/mazda_dash/alerts/detectors.py', import.meta.url), 'utf8')
    const block = source.slice(source.indexOf('DETECTORS: dict'))
    const rules = [...block.slice(0, block.indexOf('}')).matchAll(/"([a-z_]+)":/g)].map((m) => m[1])
    expect(rules.length).toBeGreaterThan(10)
    expect(Object.keys(ALERT_PART).sort()).toEqual([...rules].sort())
  })
  it('counts the open alerts per part and marks the part without changing its state', () => {
    const open = [a('low_tire_pressure', 'low_tire_pressure:rear left:2026-06-27'), a('low_tire_pressure', 'low_tire_pressure:rear left:2026-06-29'),
      a('oil_change_due', 'oil_change_due:x'), a('data_gap', 'data_gap:x')]
    expect(alertCounts(open)).toEqual({ wheel_rl: 2, engine: 1 })
    expect(alertCounts(undefined)).toEqual({})
    const overview = { status: { at: '2026-11-10T13:50:00Z', tire_fl_kpa: 240, tire_fr_kpa: 240, tire_rl_kpa: 235, tire_rr_kpa: 240 } } as never
    const plain = carState(overview, undefined, undefined, undefined)
    const marked = carState(overview, undefined, undefined, undefined, {}, alertCounts(open))
    const wheel = (c: typeof plain) => c.parts.find((p) => p.id === 'wheel_rl')!
    expect(wheel(marked).alerts).toBe(2)
    expect(wheel(marked).state).toBe(wheel(plain).state)
    expect(wheel(plain).alerts).toBeUndefined()
    // the engine is not sent by this car (no oil answer): an absent part gets no marker
    expect(marked.parts.find((p) => p.id === 'engine')!.alerts).toBeUndefined()
    expect(alertsText(1)).toBe('1 open alert')
    expect(alertsText(3)).toBe('3 open alerts')
  })
  it('names a part for the Alerts page and refuses anything else', () => {
    expect(partName('wheel_rl')).toBe('Rear left wheel')
    expect(partName('dash')).toBe('Dashboard')
    expect([partName('nope'), partName(null), partName('')]).toEqual([null, null, null])
  })
})

describe('the car at an earlier report (M56)', () => {
  const report = (at: string, over: Partial<StatusPoint> = {}): StatusPoint => ({
    created_at: at, odometer_km: 1000, fuel_level_pct: 50, range_km: 400, tire_fl_kpa: 240, tire_fr_kpa: 240, tire_rl_kpa: 240, tire_rr_kpa: 240, ...over,
  }) as StatusPoint
  const doorAt = (at: string, over: Partial<DoorPoint> = {}): DoorPoint => ({ created_at: at, door_driver: 0, door_passenger: 0, door_rear_left: 0, door_rear_right: 0, trunk: 0, hood: 0, invalid_signals: 0, ...over }) as DoorPoint
  const reports = [
    report('2026-06-01T08:00:00Z', { fuel_level_pct: 80 }),
    report('2026-06-03T18:00:00Z', { fuel_level_pct: 20, tire_rl_kpa: 200 }),
    report('2026-06-02T12:00:00Z', { fuel_level_pct: 60, odometer_km: 1100 }), // out of order on purpose
  ]
  const part = (c: CarState, id: PartId) => c.parts.find((p) => p.id === id)!

  it('shows the report asked for, in time order, with its place among them', () => {
    const second = carStateAt(1, reports, [], [])
    expect([second.index, second.total, second.at]).toEqual([2, 3, '2026-06-02T12:00:00Z'])
    expect(part(second.car, 'fuel').value).toContain('60')
    expect(part(second.car, 'dash').value).toContain(fmtNum(1100))
    const last = carStateAt(2, reports, [], [])
    expect(part(last.car, 'fuel').value).toContain('20')
    expect(part(last.car, 'wheel_rl').state).toBe('attention') // 40 kPa under the others, by the same rule
    expect(reportText(second)).toBe('report 2 of 3')
  })
  it('stays inside the reports there are', () => {
    expect(carStateAt(-5, reports, [], []).index).toBe(1)
    expect(carStateAt(99, reports, [], []).index).toBe(3)
    expect(carStateAt(1.4, reports, [], []).index).toBe(2)
    const none = carStateAt(0, [], [], [])
    expect([none.index, none.total, none.at, none.car.hasData]).toEqual([0, 0, null, false])
    expect(carStateAt(0, undefined, undefined, undefined).total).toBe(0)
  })
  it('uses the newest door report made by then, never a later one', () => {
    const doors = [doorAt('2026-06-01T07:00:00Z'), doorAt('2026-06-02T11:00:00Z', { trunk: 1 }), doorAt('2026-06-03T19:00:00Z', { hood: 1 })]
    expect(part(carStateAt(0, reports, doors, []).car, 'trunk').state).toBe('ok')
    expect(part(carStateAt(1, reports, doors, []).car, 'trunk').state).toBe('open') // the door report an hour older
    const last = carStateAt(2, reports, doors, []).car
    expect(part(last, 'trunk').state).toBe('open')
    expect(part(last, 'hood').state).toBe('ok') // opened an hour AFTER this report
    // before any door report: the doors are not known yet
    expect(part(carStateAt(0, reports, [doorAt('2026-06-05T00:00:00Z')], []).car, 'trunk').state).toBe('absent')
  })
  it('keeps an old tire reading marked old, and a fresh one fresh', () => {
    const reading = {
      reading_at: '2026-06-02T11:50:00Z', time_known: true, first_snapshot_at: '2026-06-02T12:00:00Z', last_snapshot_at: '2026-06-03T18:00:00Z',
      snapshots: 2, age_minutes: 10, last_age_minutes: 1810, stale: true,
    } as TireReading
    const fresh = part(carStateAt(1, reports, [], [reading]).car, 'wheel_fl')
    expect(fresh.old).toBe(false)
    expect(fresh.notes.join(' ')).toContain('measured')
    const old = part(carStateAt(2, reports, [], [reading]).car, 'wheel_fl')
    expect(old.old).toBe(true)
    expect(old.notes.join(' ')).toContain('old reading')
    // a report no reading covers: the time of measurement is unknown, never invented
    expect(part(carStateAt(0, reports, [], [reading]).car, 'wheel_fl').notes).toContain('measurement time unknown')
  })
  it('leaves out the states of the newest data and says so', () => {
    const car = carStateAt(2, reports, [], []).car
    expect(part(car, 'engine').state).toBe('absent')
    expect(car.parts.every((p) => p.alerts === undefined)).toBe(true)
    expect(SCRUB_NOTE).toContain('are not shown here')
  })
})
