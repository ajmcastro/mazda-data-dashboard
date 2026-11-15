import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DtcFrequency, ModelUnit } from './api/types'
import { FAULT_MAP_NOTES, ZONES, faultMap, faultsText } from './faultmap'

const fault = (ecu: string, active: boolean, code = 'U0198'): DtcFrequency => ({
  ecu, ecu_title: ecu === 'BCM' ? 'Body control module' : null, dtc_code: code, title: 'x', severity: 'warning', readouts: 1,
  first_seen: '2026-06-01T00:00:00Z', last_seen: '2026-06-02T00:00:00Z', active_in_latest_readout: active,
}) as DtcFrequency
const unit = (ecu: string, over: Partial<ModelUnit> = {}): ModelUnit => ({ ecu, zone: 'engine bay', at: null, source: null, ...over })

describe('the fault map', () => {
  const faults = [fault('BCM', true), fault('BCM', false, 'B1000'), fault('DCM', false), fault('ADU', true)]

  it('draws only the units the owner placed, lit by their faults', () => {
    const map = faultMap([unit('BCM', { zone: 'dashboard', source: 'dealer' }), unit('ECM')], faults)
    expect(map.units.map((u) => [u.ecu, u.state, u.active, u.past, u.where])).toEqual([
      ['BCM', 'active', 1, 1, 'Dashboard'], ['ECM', 'quiet', 0, 0, 'Engine bay'],
    ])
    expect(map.units[0]).toMatchObject({ title: 'Body control module', source: 'dealer', along: ZONES.dashboard.along, across: 0.5 })
  })
  it('lists a unit with faults and no place, with the line to add, and never draws it', () => {
    const map = faultMap([unit('BCM', { zone: 'dashboard' })], faults)
    expect(map.unplaced.map((u) => [u.ecu, u.active, u.past])).toEqual([['ADU', 1, 0], ['DCM', 0, 1]]) // active first
    expect(map.unplaced[0].line).toBe('  ADU: {zone: engine bay, source: "where you learned it"}')
    expect(map.units.map((u) => u.ecu)).toEqual(['BCM'])
    expect(faultMap([], faults).units).toEqual([])
    expect(faultMap(undefined, faults).unplaced).toHaveLength(3)
    expect(faultMap(undefined, undefined)).toEqual({ units: [], unplaced: [] })
  })
  it('marks a unit past when its faults are not in the latest read-out', () => {
    expect(faultMap([unit('DCM')], faults).units[0].state).toBe('past')
  })
  it('uses a position when the owner gave one, kept inside the car', () => {
    const [u] = faultMap([unit('BCM', { zone: null, at: [0.3, 0.2, 0.4] }), unit('X', { zone: null, at: [1.4, -1, 0] })], faults).units
    expect([u.along, u.across, u.where]).toEqual([0.3, 0.2, 'placed by position'])
    const far = faultMap([unit('X', { zone: null, at: [1.4, -1, 0] })], []).units[0]
    expect([far.along, far.across]).toEqual([1, 0])
  })
  it('spreads the units of one zone across the car, in the file\'s order', () => {
    const map = faultMap([unit('A'), unit('B'), unit('C')], [])
    expect(map.units.map((u) => u.across)).toEqual([0.22, 0.5, 0.78])
    expect(new Set(map.units.map((u) => u.along)).size).toBe(1)
  })
  it('does not draw a unit in a zone it does not know', () => {
    expect(faultMap([unit('A', { zone: 'glovebox' })], [fault('A', true)])).toMatchObject({ units: [], unplaced: [{ ecu: 'A' }] })
  })
  it('has the zones the backend accepts, each with a place', () => {
    const py = readFileSync(new URL('../../backend/src/mazda_dash/models.py', import.meta.url), 'utf8')
    const zones = [.../ZONES = \(([^)]*)\)/.exec(py)![1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
    expect(Object.keys(ZONES).sort()).toEqual([...zones].sort())
    for (const z of Object.values(ZONES)) expect(z.along > 0 && z.along < 1).toBe(true)
  })
  it('counts faults in words and promises no guessing', () => {
    expect(faultsText({ active: 2, past: 1 })).toBe('2 active, 1 past faults')
    expect(faultsText({ active: 0, past: 1 })).toBe('1 past fault')
    expect(faultsText({ active: 0, past: 0 })).toBe('no fault in this period')
    expect(FAULT_MAP_NOTES.join(' ')).toContain('Nothing is guessed')
  })
})
