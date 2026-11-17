import { describe, expect, it } from 'vitest'
import type { FrameVoltage, VoltageGroup } from './api/types'
import { tr } from './i18n'
import { ENGLISH_LEFT, PT_VERDICT, inPortuguese } from './i18n/testing'
import { VOLTAGE_NOTE, engineNote, groupLine, trendLine } from './voltage'

const group = (over: Partial<VoltageGroup> = {}): VoltageGroup => ({
  state: 'running', frames: 32, days: 23, first_at: '2026-04-26T00:42:00Z', last_at: '2026-07-27T03:00:00Z', span_days: 92.1,
  median: 13.68, low: 13.2, high: 14.2, enough: true, per_degree: -0.023, per_30_days: -0.16, flat: false,
  change_at: null, change_before: null, change_after: null, ...over,
})
const answer = (groups: VoltageGroup[]): FrameVoltage => ({ starting_seconds: 60, min_frames: 12, min_days: 4, min_span_days: 60, frames: [], groups })
const few = group({ frames: 4, days: 4, first_at: '2026-08-09T12:34:33Z', last_at: '2026-10-15T11:41:10Z', median: 13.5, low: 13.5, high: 13.75, enough: false, per_30_days: null, flat: null, per_degree: null })

describe('a group of frames', () => {
  it('gives its level and, with enough frames, the trend', () => {
    expect(groupLine(group(), answer([group()]))).toBe(
      'With the engine running: 13.68 V in the middle, 13.20 V to 14.20 V; 32 frames on 23 days from 26 Apr 2026 to 27 Jul 2026. Taking the outside temperature into account, the voltage recorded with faults moved about −0.16 V every 30 days.',
    )
  })

  it('says why there is no trend with too few frames', () => {
    expect(groupLine(few, answer([few]))).toBe(
      'With the engine running: 13.50 V in the middle, 13.50 V to 13.75 V; 4 frames on 4 days from 09 Aug 2026 to 15 Oct 2026. Too few to look for a trend (it needs 12 frames on 4 different days over 60 days).',
    )
    expect(groupLine(group({ state: 'off', frames: 0 }), answer([]))).toBe('No frame with the engine off.')
  })

  it('says level, rising, or a step', () => {
    expect(trendLine(group({ flat: true, per_30_days: 0.01 }))).toBe('Taking the outside temperature into account, the voltage recorded with faults stayed about level.')
    expect(trendLine(group({ per_30_days: 0.2 }))).toMatch(/moved about \+0\.20 V every 30 days/)
    expect(trendLine(group({ change_at: '2026-06-10T08:00:00Z', change_before: 13.9, change_after: 13.3 }))).toMatch(/Around 10 Jun 2026 it stepped from about 13\.90 V to about 13\.30 V\.$/)
  })
})

describe('the note on the engine', () => {
  it('appears only for a running trend that is not level', () => {
    expect(engineNote(answer([group()]))).toBe('battery: the voltage recorded with faults (engine running) moved about −0.16 V every 30 days')
    expect(engineNote(answer([group({ flat: true })]))).toBeNull()
    expect(engineNote(answer([few]))).toBeNull()
    expect(engineNote(answer([group({ state: 'off' })]))).toBeNull()
    expect(engineNote(undefined)).toBeNull()
  })
})

describe('the wording stays neutral', () => {
  const all = () => [groupLine(group(), answer([group()])), groupLine(few, answer([few])), engineNote(answer([group()])), tr(VOLTAGE_NOTE, { seconds: 60 })].join(' ')

  it('never calls the battery weak, failing or healthy', () => {
    expect(all()).not.toMatch(/\b(weak|failing|dying|healthy|replace|bad|good|worse|better|should|problem)\b/i)
    expect(VOLTAGE_NOTE).toMatch(/not the battery’s health/)
  })

  it('in Portuguese too', () => {
    const pt = inPortuguese(all)
    expect(pt).not.toBe(all())
    expect(pt).not.toMatch(PT_VERDICT)
    expect(pt).not.toMatch(ENGLISH_LEFT)
  })
})
