import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { CarWarnings, DayEntry, DoorPoint, LatestStatus, Occupancy, Overview, SignalValues, StatusPoint } from './api/types'
import { carNotes, carState, carStateAt, CAR_NOTES } from './car'
import { describe as describeEntry } from './day'
import { inPortuguese } from './i18n/testing'
import { sensorRows } from './occupancy'
import { SIGNAL_LABELS, alarmText, documents, engineStateNote, meaningOf, meanings, valueText } from './signals'

const here = fileURLToPath(new URL('.', import.meta.url))
const platforms = join(here, '../../config/platforms')

/** A table like the API's for 24PF, with the values these tests use. */
const answer: SignalValues = {
  platform: '24PF',
  source: 'test',
  values: [
    { signal: 'enginestate', value: 10, label: 'Running with stop-start on', state: 'info' },
    { signal: 'enginestate', value: 7, label: 'Stopped by stop-start', state: 'info' },
    { signal: 'locklinkswdrv', value: 0, label: 'Unlocked', state: 'info' },
    { signal: 'locklinkswdrv', value: 2, label: 'Locked', state: 'ok' },
    { signal: 'locklinkswdrv', value: 3, label: 'Failure', state: 'attention' },
    { signal: 'locklinkswpsngr', value: 0, label: 'Locked', state: 'ok' },
    { signal: 'locklinkswpsngr', value: 1, label: 'Unlocked', state: 'info' },
    { signal: 'fltyrepresswarn', value: 1, label: 'Low', state: 'attention' },
    { signal: 'fltyrepresswarn', value: 2, label: 'Not available', state: 'unknown' },
    { signal: 'oillevelwarning', value: 2, label: 'Over the high mark', state: 'attention' },
    { signal: 'burglarstatus', value: 3, label: 'Armed', state: 'ok' },
    { signal: 'burglarstatus', value: 5, label: 'Alarm sounding', state: 'attention' },
    { signal: 'balarmreasondactl', value: 1, label: 'Door', state: 'info' },
    { signal: 'ocsstatus', value: 3, label: 'Malfunction', state: 'attention' },
    { signal: 'x', value: 1, label: 'Odd', state: 'not-a-state' },
  ],
}
const m = meanings(answer)
const AT = '2026-07-01T08:00:00Z'

const overview = (status: Partial<LatestStatus> = {}): Overview => ({
  odometer_km: 41250, odometer_at: AT, has_data_in_range: true,
  warnings_total: 0, warnings_in_range: 0, active_faults: 0, faults_seen: 0, unmapped_codes: 0, alerts_new: 0,
  status: { at: AT, fuel_level_pct: 62, range_km: 410, tire_fl_kpa: 240, tire_fr_kpa: 238, tire_rl_kpa: 235, tire_rr_kpa: 236, ...status },
})
const door = (over: Partial<DoorPoint> = {}): DoorPoint => ({
  created_at: AT, door_driver: 0, door_passenger: 0, door_rear_left: 0, door_rear_right: 0, trunk: 0, hood: 0,
  lock_driver: 2, lock_passenger: 0, hazard_switch: 0, light_switch: 0, invalid_signals: 0, ...over,
})
const flags = (flag: string, value: number, is_on: boolean): CarWarnings => ({
  has_data: true, all_clear: !is_on, episodes: [],
  flags: [{ flag, label: flag, is_on, value, last_read_at: AT, readings: 3, episodes: is_on ? 1 : 0, since: is_on ? AT : null }],
})
const part = (car: ReturnType<typeof carState>, id: string) => car.parts.find((p) => p.id === id)!

describe('the table of documented values', () => {
  it('gives a value its words, and nothing for a value or a state it does not know', () => {
    expect(meaningOf(m, 'enginestate', 10)).toEqual({ label: 'Running with stop-start on', state: 'info' })
    expect(meaningOf(m, 'enginestate', 4)).toBeNull()
    expect(meaningOf(m, 'enginestate', null)).toBeNull()
    expect(meaningOf(m, 'x', 1)).toBeNull()
    expect(valueText(m, 'enginestate', 4)).toBe('4')
    expect(documents(m, 'locklinkswdrv')).toBe(true)
    expect(documents(m, 'lock')).toBe(false)
  })

  it('is empty without an answer, so every page keeps the raw numbers', () => {
    const none = meanings(undefined)
    expect(valueText(none, 'burglarstatus', 3)).toBe('3')
    expect(alarmText(none, 3, 1)).toBe('status 3, reason 1')
    expect(engineStateNote(none, 10)).toBeNull()
  })

  it('has a Portuguese label for every label of every platform file', () => {
    const labels = readdirSync(platforms).flatMap((p) =>
      [...readFileSync(join(platforms, p, 'signal_values.yaml'), 'utf8').replace(/^\s*#.*$/gm, '').matchAll(/label: ("[^"]*"|[^,}]+)/g)].map((x) => x[1].replace(/^"|"$/g, '').trim()),
    )
    expect(labels.length).toBeGreaterThan(40)
    expect(labels.filter((l) => !(SIGNAL_LABELS as readonly string[]).includes(l))).toEqual([])
  })

  it('words an alarm reading', () => {
    expect(alarmText(m, 3, 0)).toBe('Armed')
    expect(alarmText(m, 5, 1)).toBe('Alarm sounding, reason: door')
    expect(alarmText(m, 9, 1)).toBe('status 9, reason: door')
    expect(inPortuguese(() => alarmText(m, 5, 1))).toBe('Alarme a tocar, motivo: porta')
  })
})

describe('the car view with documented values (M72)', () => {
  it('says locked and unlocked, each lock switch on its own scale', () => {
    const car = carState(overview(), door({ lock_driver: 2, lock_passenger: 0 }), undefined, undefined, {}, {}, m)
    expect(part(car, 'door_driver').notes).toContain('lock: locked')
    expect(part(car, 'door_passenger').notes).toContain('lock: locked')
    const open = carState(overview(), door({ lock_driver: 0, lock_passenger: 1 }), undefined, undefined, {}, {}, m)
    expect(part(open, 'door_driver').notes).toContain('lock: unlocked')
    expect(part(open, 'door_passenger').notes).toContain('lock: unlocked')
    expect(inPortuguese(() => part(carState(overview(), door(), undefined, undefined, {}, {}, m), 'door_driver').notes)).toContain('fecho: trancada')
  })

  it('marks a door whose lock switch reports a failure, and keeps raw codes without the table', () => {
    const failed = carState(overview(), door({ lock_driver: 3 }), undefined, undefined, {}, {}, m)
    expect(part(failed, 'door_driver').state).toBe('attention')
    const raw = carState(overview(), door({ lock_driver: 3 }), undefined, undefined)
    expect(part(raw, 'door_driver').state).toBe('ok')
    expect(part(raw, 'door_driver').notes).toContain('lock code 3')
  })

  it('drops the note about raw lock codes only when the platform documents them', () => {
    expect(carNotes(m)).not.toContain(CAR_NOTES[1])
    expect(carNotes(meanings(undefined))).toEqual(CAR_NOTES)
  })

  it('notes the engine state, never as a state of its own', () => {
    const car = carState(overview({ engine_state: 7 }), door(), undefined, undefined, {}, {}, m)
    expect(part(car, 'engine').notes).toContain('engine: stopped by stop-start')
    expect(part(car, 'engine').state).toBe('ok')
    expect(part(carState(overview({ engine_state: 7 }), door(), undefined, undefined), 'engine').state).toBe('absent')
  })

  it('names the car’s flags in words, and a flag documented as not available is no warning', () => {
    const low = carState(overview(), door(), undefined, flags('fltyrepresswarn', 1, true), {}, {}, m)
    expect(part(low, 'wheel_fl').notes).toContain("the car's tire flag is on (low)")
    const na = carState(overview(), door(), undefined, flags('fltyrepresswarn', 2, false), {}, {}, m)
    expect(part(na, 'wheel_fl').state).toBe('ok')
    expect(part(na, 'wheel_fl').notes).toContain("the car's tire flag: not available")
    const oil = carState(overview(), door(), undefined, flags('oillevelwarning', 2, true), {}, {}, m)
    expect(part(oil, 'engine').notes).toContain("the car's oil level flag is on (over the high mark)")
    const raw = carState(overview(), door(), undefined, flags('fltyrepresswarn', 1, true))
    expect(part(raw, 'wheel_fl').notes).toContain("the car's tire flag is on (raw 1)")
  })

  it('shows the engine state of an earlier report too', () => {
    const reports: StatusPoint[] = [
      { created_at: '2026-07-01T06:00:00Z', engine_state: 7, fuel_level_pct: 50 },
      { created_at: AT, engine_state: 10, fuel_level_pct: 49 },
    ]
    expect(part(carStateAt(0, reports, [door()], [], m).car, 'engine').notes).toContain('engine: stopped by stop-start')
  })
})

describe('the Day page and Who rides (M72)', () => {
  const entry = (over: Partial<DayEntry>): DayEntry => ({ kind: 'status', ...over }) as DayEntry
  it('words the engine state of a status report and an alarm reading', () => {
    expect(describeEntry(entry({ odometer_km: 100, engine_state: 10 }), m).detail).toContain('engine: running with stop-start on')
    expect(describeEntry(entry({ kind: 'alarm', alarm_status: 5, alarm_reason: 1, text: 'status 5, reason 1' }), m).detail).toBe('Alarm sounding, reason: door')
    expect(describeEntry(entry({ kind: 'alarm', alarm_status: 5, alarm_reason: 1, text: 'status 5, reason 1' })).detail).toBe('status 5, reason 1')
  })

  it('lists each seat sensor with its share and marks a malfunction', () => {
    const o = {
      sensors: [
        { seat: 'passenger', readings: 20, occupied_readings: 5, latest_label: 'Occupied', latest_state: 'info' },
        { seat: 'rear_center', readings: 20, occupied_readings: 0, latest_label: 'Malfunction', latest_state: 'attention' },
      ],
    } as unknown as Occupancy
    expect(sensorRows(o)).toEqual([
      { seat: 'passenger', label: 'Front passenger', pct: 25, readings: 20, latest: 'Occupied', attention: false },
      { seat: 'rear_center', label: 'Rear centre', pct: 0, readings: 20, latest: 'Malfunction', attention: true },
    ])
    expect(inPortuguese(() => sensorRows(o)[1].label)).toBe('Traseiro central')
    expect(sensorRows(undefined)).toEqual([])
  })
})
