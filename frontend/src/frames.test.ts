import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { FaultFrameSummary, FrameSignalSummary } from './api/types'
import { FEW_FRAMES, baselineRange, cautionNote, faultRange, hintLine, rangeText, FRAME_PART, frameCar } from './frames'
import { ENGLISH_LEFT, PT_VERDICT, inPortuguese } from './i18n/testing'

const sig = (over: Partial<FrameSignalSummary>): FrameSignalSummary => ({
  signal: 'SOC_StateOfCharge', label: 'Battery charge', unit: '%', frames: 3, min: 5, median: 15.5, max: 87.5,
  baseline_frames: 34, baseline_min: 1.5, baseline_median: 57.5, baseline_max: 87.5, baseline_p10: 10, baseline_p90: 80,
  position: null, ...over,
})
const summary = (signals: FrameSignalSummary[], frames = 3): FaultFrameSummary => ({
  ecu: 'BCM', dtc_code: 'U0198', frames, baseline_frames: 34, signals,
})

describe('ranges', () => {
  it('show min–max with the median and the unit', () => {
    expect(rangeText(12.6, 12.9, 13.1, 'V')).toBe('12.6–13.1 V (median 12.9)')
    expect(faultRange(sig({}))).toBe('5–87.5 % (median 15.5)')
    expect(baselineRange(sig({}))).toBe('1.5–87.5 % (median 57.5)')
  })
  it('collapse to one value when every frame agrees, and show a dash for no data', () => {
    expect(rangeText(52, 52, 52, '°C')).toBe('52 °C')
    expect(rangeText(null, null, null, 'V')).toBe('—')
  })
  it('leave out the unit when there is none', () => {
    expect(rangeText(1, 2, 3, null)).toBe('1–3 (median 2)')
  })
})

describe('the hint', () => {
  it('lists only the signals that stand out, in plain words', () => {
    const s = summary([sig({ position: 'low' }), sig({ label: 'Coolant temperature', signal: 'x', position: 'high' }), sig({ label: 'Vehicle speed', signal: 'v' })])
    expect(hintLine(s)).toBe('Tends to appear when battery charge is low and coolant temperature is high.')
  })
  it('keeps an acronym in capitals', () => {
    const s = summary([sig({ label: 'ECU power voltage', position: 'high' })])
    expect(hintLine(s)).toBe('Tends to appear when ECU power voltage is high.')
  })
  it('is absent when nothing stands out and never claims a cause', () => {
    expect(hintLine(summary([sig({})]))).toBeNull()
    const text = hintLine(summary([sig({ position: 'low' })])) ?? ''
    expect(text).not.toMatch(/cause|because|due to|failure of/i)
    const portuguese = inPortuguese(() => hintLine(summary([sig({ position: 'low' })])) ?? '')
    expect(portuguese).not.toBe(text)
    expect(portuguese).not.toMatch(PT_VERDICT)
    expect(portuguese).not.toMatch(ENGLISH_LEFT)
  })
})

describe('the caution', () => {
  it('warns when the fault has fewer than the minimum frames', () => {
    expect(FEW_FRAMES).toBe(5)
    expect(cautionNote({ frames: 1, baseline_frames: 36 })).toMatch(/^Only 1 frame for this fault/)
    expect(cautionNote({ frames: 4, baseline_frames: 36 })).toMatch(/^Only 4 frames/)
  })
  it('only states the baseline when there are enough frames, and always says it is not a cause', () => {
    const t = cautionNote({ frames: 7, baseline_frames: 30 })
    expect(t).not.toMatch(/^Only/)
    expect(t).toMatch(/30 frames of the car’s other faults/)
    expect(t).toMatch(/not what caused it/)
  })
})

describe('the fault on the car (M58)', () => {
  const sig = (signal: string, label: string, over = {}) => ({
    signal, label, unit: 'V', frames: 6, min: 11.4, median: 11.8, max: 12.1, baseline_frames: 40, baseline_min: 12.2, baseline_median: 12.9, baseline_max: 13.4, position: null, ...over,
  })
  const summary = (signals: unknown[], frames = 6) => ({ ecu: 'ECM', dtc_code: 'P0562', frames, baseline_frames: 40, signals }) as never
  const part = (c: ReturnType<typeof frameCar>, id: string) => c.parts.find((p) => p.id === id)!

  it('puts each signal on its part and leaves every other part out', () => {
    const car = frameCar(summary([
      sig('Main_ECU_Voltage_Supply', 'Battery voltage (main ECU supply)', { position: 'low' }),
      sig('SOC_StateOfCharge', 'Battery charge', { unit: '%', min: 60, median: 70, max: 80, baseline_min: 50, baseline_median: 75, baseline_max: 95 }),
      sig('Engine_Coolant_Temperature', 'Coolant temperature', { unit: '°C', min: 20, median: 60, max: 90 }),
      sig('Vehicle_Speed', 'Vehicle speed', { unit: 'km/h', min: 0, median: 0, max: 0 }),
    ]))
    expect(car.hasData).toBe(true)
    expect(car.parts.filter((p) => p.state !== 'absent').map((p) => [p.id, p.name])).toEqual([['hood', 'Battery'], ['engine', 'Engine'], ['dash', 'Dashboard']])
    expect(part(car, 'hood').value).toBe('11.4–12.1 V (median 11.8)')
    expect(part(car, 'hood').notes).toHaveLength(3) // two signals, and one position
    expect(part(car, 'hood').notes[0]).toContain("in the other faults' frames")
    expect(part(car, 'dash').value).toBe('0 km/h')
  })
  it('marks a part only where the summary marks a position', () => {
    const car = frameCar(summary([
      sig('Main_ECU_Voltage_Supply', 'Battery voltage (main ECU supply)', { position: 'low' }),
      sig('Engine_Coolant_Temperature', 'Coolant temperature', { unit: '°C', min: 119, median: 120, max: 121 }), // odd, but not marked by the summary
    ]))
    expect(part(car, 'hood').state).toBe('attention')
    expect(part(car, 'engine').state).toBe('ok')
    expect(part(car, 'dash').state).toBe('absent')
    const none = frameCar(summary([sig('ECU_Power_Voltage', 'ECU power voltage')]))
    expect(none.parts.filter((p) => p.state === 'attention')).toEqual([])
  })
  it('has nothing to draw without frames, and every signal of the summary has a part', () => {
    expect(frameCar(summary([])).hasData).toBe(false)
    expect(frameCar(undefined).hasData).toBe(false)
    expect(frameCar(summary([sig('Vehicle_Speed', 'Vehicle speed', { min: null, median: null, max: null })])).hasData).toBe(false)
    const py = readFileSync(new URL('../../backend/src/mazda_dash/api/app.py', import.meta.url), 'utf8')
    const block = py.slice(py.indexOf('FRAME_SUMMARY_SIGNALS = ['))
    const names = [...block.slice(0, block.indexOf(']')).matchAll(/\("([A-Za-z_]+)"/g)].map((m) => m[1])
    expect(names.length).toBe(5)
    expect(Object.keys(FRAME_PART).sort()).toEqual([...names].sort())
  })
  it('keeps the caution for a fault with few frames', () => {
    expect(cautionNote({ frames: 2, baseline_frames: 40 })).toContain('Only 2 frames')
  })
})
