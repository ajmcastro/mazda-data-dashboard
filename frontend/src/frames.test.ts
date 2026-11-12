import { describe, expect, it } from 'vitest'
import type { FaultFrameSummary, FrameSignalSummary } from './api/types'
import { FEW_FRAMES, baselineRange, cautionNote, faultRange, hintLine, rangeText } from './frames'

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
