/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { fmtNum } from './lib'
import {
  DEFAULT_UNITS, consumptionDigits, consumptionHigherIsBetter, consumptionLabel, distanceLabel, fmtConsumption,
  fmtDistance, fmtPressure, fmtSpeed, getUnits, parseUnits, per100Label, pressureDigits, setUnits, speedLabel,
  distanceText, pressureText, toConsumption, toDistance, toPer100, toPressure, toSpeed, unitsKey, type Units,
} from './units'

const u = (over: Partial<Units>): Units => ({ ...DEFAULT_UNITS, ...over })
afterEach(() => setUnits(DEFAULT_UNITS))

describe('the choice', () => {
  it('defaults to what the data is in', () => {
    expect(DEFAULT_UNITS).toEqual({ pressure: 'kPa', consumption: 'l/100km', distance: 'km' })
    expect(getUnits()).toEqual(DEFAULT_UNITS)
  })

  it('reads a stored choice and ignores anything it does not know', () => {
    expect(parseUnits('{"pressure":"bar","consumption":"mpg-uk","distance":"mi"}')).toEqual({ pressure: 'bar', consumption: 'mpg-uk', distance: 'mi' })
    expect(parseUnits('{"pressure":"atm","distance":"mi"}')).toEqual(u({ distance: 'mi' }))
    for (const junk of [null, undefined, '', 'bar', '[1]', '{', 7]) expect(parseUnits(junk)).toEqual(DEFAULT_UNITS)
  })

  it('is what the formatters use, and its key changes with it', () => {
    const before = unitsKey()
    setUnits(u({ pressure: 'bar' }))
    expect(getUnits().pressure).toBe('bar')
    expect(unitsKey()).not.toBe(before)
    expect(fmtPressure(245)).toBe(fmtNum(2.45, 2, 'bar'))
    setUnits(DEFAULT_UNITS)
    expect(unitsKey()).toBe(before)
    expect(fmtPressure(245)).toBe(fmtNum(245, 0, 'kPa'))
  })
})

describe('pressure', () => {
  it('converts kPa to bar and psi', () => {
    expect(toPressure(250, u({ pressure: 'kPa' }))).toBe(250)
    expect(toPressure(250, u({ pressure: 'bar' }))).toBeCloseTo(2.5, 10)
    expect(toPressure(250, u({ pressure: 'psi' }))).toBeCloseTo(36.26, 2)
  })
  it('shows the decimals that make sense in each unit', () => {
    expect(fmtPressure(245, true, u({ pressure: 'kPa' }))).toBe(fmtNum(245, 0, 'kPa'))
    expect(fmtPressure(245, true, u({ pressure: 'bar' }))).toBe(fmtNum(2.45, 2, 'bar'))
    expect(fmtPressure(245, true, u({ pressure: 'psi' }))).toBe(fmtNum(35.5, 1, 'psi'))
    expect(fmtPressure(245, false, u({ pressure: 'bar' }))).toBe(fmtNum(2.45, 2))
    expect([pressureDigits(u({ pressure: 'kPa' })), pressureDigits(u({ pressure: 'bar' })), pressureDigits(u({ pressure: 'psi' }))]).toEqual([0, 2, 1])
  })
  it('keeps a missing value missing, never zero', () => {
    for (const unit of ['kPa', 'bar', 'psi'] as const) {
      expect(toPressure(null, u({ pressure: unit }))).toBeNull()
      expect(toPressure(undefined, u({ pressure: unit }))).toBeNull()
      expect(fmtPressure(null, true, u({ pressure: unit }))).toBe('—')
    }
  })
})

describe('distance, speed and amounts per distance', () => {
  it('converts km to miles and back to the same figure', () => {
    expect(toDistance(100, u({ distance: 'km' }))).toBe(100)
    expect(toDistance(160.9344, u({ distance: 'mi' }))).toBeCloseTo(100, 10)
    expect(toSpeed(100, u({ distance: 'mi' }))).toBeCloseTo(62.137, 3)
    expect(fmtDistance(1609.344, 0, true, u({ distance: 'mi' }))).toBe(fmtNum(1000, 0, 'mi'))
    expect(fmtDistance(12.34, 1, false)).toBe(fmtNum(12.3, 1))
    expect(fmtSpeed(100, 0, u({ distance: 'mi' }))).toBe(fmtNum(62, 0, 'mph'))
    expect(fmtDistance(null)).toBe('—')
  })
  it('turns a cost per 100 km into a cost per 100 miles (more, not less)', () => {
    expect(toPer100(10, u({ distance: 'km' }))).toBe(10)
    expect(toPer100(10, u({ distance: 'mi' }))).toBeCloseTo(16.09344, 5)
    expect(toPer100(null)).toBeNull()
  })
  it('names them', () => {
    expect([distanceLabel(), speedLabel(), per100Label()]).toEqual(['km', 'km/h', '100 km'])
    const mi = u({ distance: 'mi' })
    expect([distanceLabel(mi), speedLabel(mi), per100Label(mi)]).toEqual(['mi', 'mph', '100 mi'])
  })
})

describe('fuel consumption', () => {
  it('converts l/100 km to km/l and to both gallons', () => {
    expect(toConsumption(8, u({ consumption: 'l/100km' }))).toBe(8)
    expect(toConsumption(8, u({ consumption: 'km/l' }))).toBeCloseTo(12.5, 10)
    expect(toConsumption(8, u({ consumption: 'mpg-uk' }))).toBeCloseTo(35.31, 2)
    expect(toConsumption(8, u({ consumption: 'mpg-us' }))).toBeCloseTo(29.4, 2)
  })
  it('has no value upside down for a consumption of zero or less', () => {
    for (const unit of ['km/l', 'mpg-uk', 'mpg-us'] as const) {
      expect(toConsumption(0, u({ consumption: unit }))).toBeNull()
      expect(toConsumption(-1, u({ consumption: unit }))).toBeNull()
      expect(fmtConsumption(0, 1, true, u({ consumption: unit }))).toBe('—')
    }
    expect(toConsumption(0, u({ consumption: 'l/100km' }))).toBe(0)
    expect(toConsumption(null)).toBeNull()
  })
  it('knows that a higher figure is better in km/l and mpg, and only there', () => {
    expect(consumptionHigherIsBetter(u({ consumption: 'l/100km' }))).toBe(false)
    for (const unit of ['km/l', 'mpg-uk', 'mpg-us'] as const) expect(consumptionHigherIsBetter(u({ consumption: unit }))).toBe(true)
  })
  it('orders two cars the same way in every unit: the thriftier one is the better one', () => {
    for (const unit of ['l/100km', 'km/l', 'mpg-uk', 'mpg-us'] as const) {
      const units = u({ consumption: unit })
      const [thrifty, thirsty] = [toConsumption(5, units)!, toConsumption(9, units)!]
      expect(consumptionHigherIsBetter(units) ? thrifty > thirsty : thrifty < thirsty).toBe(true)
    }
  })
  it('names and formats it', () => {
    expect(consumptionLabel()).toBe('l/100 km')
    expect(consumptionLabel(u({ consumption: 'mpg-uk' }))).toBe('mpg (UK)')
    expect(fmtConsumption(7.26, 2)).toBe(fmtNum(7.26, 2))
    expect(fmtConsumption(7.26, 2, true)).toBe(fmtNum(7.26, 2, 'l/100 km'))
    expect(fmtConsumption(8, 2, true, u({ consumption: 'km/l' }))).toBe(fmtNum(12.5, 1, 'km/l'))
    expect([consumptionDigits(2), consumptionDigits(2, u({ consumption: 'mpg-us' }))]).toEqual([2, 1])
  })
})

describe('inside a sentence', () => {
  it('uses an ordinary space before the unit, and a dash for nothing', () => {
    expect(distanceText(5307)).toBe(`${fmtNum(5307)} km`)
    expect(distanceText(1609.344, 0, u({ distance: 'mi' }))).toBe(`${fmtNum(1000)} mi`)
    expect(pressureText(25, u({ pressure: 'bar' }))).toBe(`${fmtNum(0.25, 2)} bar`)
    expect(distanceText(null)).toBe('—')
    expect(pressureText(undefined)).toBe('—')
  })
})

// Every page shows these figures through this module. A unit written into a page would stay in kPa or km when
// the reader chose something else, so pages and components may not spell one out.
describe('no page spells out a unit that the reader can choose', () => {
  const src = fileURLToPath(new URL('.', import.meta.url))
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : []
    })
  /** Where a unit may be written: this module, the metric table (the data's own units), the raw freeze-frame
   *  units the diagnostic tool prints, the alerts note, and the car's shapes (dimensions, not figures). */
  const ALLOWED = new Set(['units.ts', 'trends.ts', 'lib.ts', 'compare.ts', 'pages/Alerts.tsx', 'api/schema.d.ts'])
  const code = (text: string) =>
    text.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).map((line) => line.replace(/\s\/\/ .*$/, '')).join('\n')
  const files = walk(src)
    .map((path) => ({ rel: relative(src, path), text: code(readFileSync(path, 'utf8')) }))
    .filter((f) => !ALLOWED.has(f.rel) && !f.rel.startsWith('car3d/shapes/') && !f.rel.startsWith('i18n/'))

  it('finds the pages', () => {
    expect(files.map((f) => f.rel)).toEqual(expect.arrayContaining(['pages/Overview.tsx', 'pages/Status.tsx', 'car.ts', 'garage.ts', 'components/Tires.tsx']))
  })

  it.each([
    ['kPa', /['"`>][^'"`<\n]*\bkPa\b/],
    ['l/100 km', /l\/100 ?km/],
    ['km as a unit', /fmtNum\([^)\n]*, ?['"]km['"]\)|\} km\b|>km</],
    ['km/h', /['"`>][^'"`<\n]*\bkm\/h\b/],
  ])('%s', (_name, pattern) => {
    const offenders = files.filter((f) => pattern.test(f.text)).map((f) => f.rel)
    expect(offenders).toEqual([])
  })
})

// ---- Trends and Compare in the reader's units ----
import type { MonthMetrics } from './api/types'
import { comparePeriods, summarise } from './compare'
import { METRICS, compare, digitsFor, metricValue, polarityOf, rawValue, unitFor } from './trends'

describe('Trends and Compare in other units', () => {
  const def = (key: string) => METRICS.find((m) => m.key === key)!
  const month = (over: Partial<MonthMetrics>): MonthMetrics =>
    ({ month: '2026-05', days_in_month: 31, days_covered: 31, partial: false, ...over }) as MonthMetrics

  it('names each figure in the unit shown, per day and per 100 too', () => {
    setUnits(u({ pressure: 'bar', consumption: 'mpg-uk', distance: 'mi' }))
    expect(unitFor(def('distance_km'), false)).toBe('mi')
    expect(unitFor(def('distance_km'), true)).toBe('mi/day')
    expect(unitFor(def('l_per_100km'), false)).toBe('mpg (UK)')
    expect(unitFor(def('avg_speed_kmh'), false)).toBe('mph')
    expect(unitFor(def('tire_min_kpa'), false)).toBe('bar')
    expect(unitFor(def('cost_per_100km'), false, 'EUR')).toBe('EUR/100 mi')
    expect(unitFor(def('warning_events'), true)).toBe('events/day') // not a figure with a unit to choose
    expect([digitsFor(def('tire_avg_kpa'), false), digitsFor(def('l_per_100km'), false)]).toEqual([2, 1])
  })

  it('leaves the names and digits of the defaults as they were', () => {
    expect(unitFor(def('distance_km'), true)).toBe('km/day')
    expect(unitFor(def('l_per_100km'), false)).toBe('l/100 km')
    expect(unitFor(def('cost_per_100km'), false, 'EUR')).toBe('EUR/100 km')
    expect([digitsFor(def('tire_avg_kpa'), false), digitsFor(def('l_per_100km'), false)]).toEqual([0, 2])
  })

  it('shows a month in the unit chosen and keeps its raw value for the maths', () => {
    const row = month({ distance_km: 1609.344, l_per_100km: 8, tire_min_kpa: 200 })
    setUnits(u({ pressure: 'bar', consumption: 'km/l', distance: 'mi' }))
    expect(metricValue(row, def('distance_km'), false)).toBeCloseTo(1000, 6)
    expect(metricValue(row, def('l_per_100km'), false)).toBeCloseTo(12.5, 6)
    expect(metricValue(row, def('tire_min_kpa'), false)).toBeCloseTo(2, 6)
    expect(rawValue(row, def('distance_km'), false)).toBe(1609.344)
    expect(rawValue(row, def('l_per_100km'), false)).toBe(8)
  })

  it('calls less fuel good in every unit: the colour follows the meaning, not the direction of the number', () => {
    const fuel = def('l_per_100km')
    for (const unit of ['l/100km', 'km/l', 'mpg-uk', 'mpg-us'] as const) {
      setUnits(u({ consumption: unit }))
      // the car went from 9 to 7 l/100 km: an improvement, whichever way the shown number moved
      const values = [month({ l_per_100km: 9 }), month({ l_per_100km: 7 })].map((r) => metricValue(r, fuel, false))
      const c = compare(fuel, values, [false, false], 1)
      expect(c.kind === 'ok' && c.tone).toBe('good')
      expect(c.kind === 'ok' && c.direction).toBe(unit === 'l/100km' ? 'down' : 'up')
      expect(polarityOf(fuel)).toBe(unit === 'l/100km' ? 'lower' : 'higher')
    }
    expect(polarityOf(def('tire_min_kpa'))).toBe('higher') // other figures never turn round
  })

  it('averages consumption in the data\'s unit, then converts: never a mean of mpg figures', () => {
    const fuel = def('l_per_100km')
    // 100 km at 10 l/100 km and 900 km at 5 l/100 km: 55 l over 1000 km = 5.5 l/100 km
    const rows = [month({ l_per_100km: 10, distance_km: 100 }), month({ month: '2026-06', l_per_100km: 5, distance_km: 900 })]
    expect(summarise(fuel, rows, false).value).toBeCloseTo(5.5, 6)
    setUnits(u({ consumption: 'km/l' }))
    expect(summarise(fuel, rows, false).value).toBeCloseTo(100 / 5.5, 6) // 18.18 km/l
    expect(summarise(fuel, rows, false).value).not.toBeCloseTo((10 * 100 + 20 * 900) / 1000, 1) // not the mean of km/l figures (19)
  })

  it('adds up a period\'s distance in km and shows the total in miles', () => {
    setUnits(u({ distance: 'mi' }))
    const a = [month({ distance_km: 804.672 })]
    const b = [month({ distance_km: 804.672 }), month({ month: '2026-06', distance_km: 804.672 })]
    const c = comparePeriods(def('distance_km'), a, b, false)
    expect(c.a.value).toBeCloseTo(500, 6)
    expect(c.b.value).toBeCloseTo(1000, 6)
  })

  it('calls a period with less fuel use good when shown in mpg', () => {
    setUnits(u({ consumption: 'mpg-us' }))
    const c = comparePeriods(def('l_per_100km'), [month({ l_per_100km: 9, distance_km: 500 })], [month({ l_per_100km: 7, distance_km: 500 })], false)
    expect(c.tone).toBe('good')
    expect(c.direction).toBe('up')
  })
})
