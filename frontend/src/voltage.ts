// Pure wording of the battery voltage in the freeze frames (PLAN.md M68). No React in here.
// Freeze frames are taken only when a fault is recorded, so these are "the voltage recorded with faults", never
// the battery's health as a fact. A trend is a measurement over the frames, never a diagnosis.

import { msg, tr, trn } from './i18n'
import type { FrameVoltage, VoltageGroup } from './api/types'
import { fmtDate, fmtNum } from './lib'

export const STATE_LABEL: Record<string, string> = {
  running: msg('engine running'),
  off: msg('engine off'),
  starting: msg('just after a start'),
  unknown: msg('engine state unknown'),
}

const volts = (v: number | null | undefined, digits = 2) => `${fmtNum(v, digits)} V`

/** What one group's frames say, in one or two sentences. */
export function groupLine(g: VoltageGroup, f: FrameVoltage): string {
  const name = tr(STATE_LABEL[g.state] ?? g.state)
  if (g.frames === 0) return tr('No frame with the {state}.', { state: name })
  const basis = tr('{frames} on {days} from {first} to {last}', {
    frames: trn('1 frame', '{n} frames', g.frames),
    days: trn('1 day', '{n} days', g.days),
    first: fmtDate(g.first_at),
    last: fmtDate(g.last_at),
  })
  const level = tr('With the {state}: {median} in the middle, {low} to {high}; {basis}.', {
    state: name, median: volts(g.median), low: volts(g.low), high: volts(g.high), basis,
  })
  if (!g.enough) {
    return `${level} ${tr('Too few to look for a trend (it needs {frames} frames on {days} different days over {span} days).', {
      frames: f.min_frames, days: f.min_days, span: f.min_span_days,
    })}`
  }
  return `${level} ${trendLine(g)}`
}

/** The temperature-adjusted trend of a group with enough frames. */
export function trendLine(g: VoltageGroup): string {
  if (g.per_30_days == null) return tr('No trend can be measured.')
  const trend = g.flat
    ? tr('Taking the outside temperature into account, the voltage recorded with faults stayed about level.')
    : tr('Taking the outside temperature into account, the voltage recorded with faults moved about {rate} every 30 days.', {
        rate: `${g.per_30_days > 0 ? '+' : '−'}${volts(Math.abs(g.per_30_days))}`,
      })
  const change = g.change_at
    ? ` ${tr('Around {date} it stepped from about {before} to about {after}.', { date: fmtDate(g.change_at), before: volts(g.change_before), after: volts(g.change_after) })}`
    : ''
  return trend + change
}

/** A note for the engine in the car view (a note, never a state), only when a running trend is not level. */
export function engineNote(f: FrameVoltage | undefined): string | null {
  const g = f?.groups.find((x) => x.state === 'running')
  if (!g?.enough || g.flat || g.per_30_days == null) return null
  return tr('battery: the voltage recorded with faults (engine running) moved about {rate} every 30 days', {
    rate: `${g.per_30_days > 0 ? '+' : '−'}${volts(Math.abs(g.per_30_days))}`,
  })
}

/** How it is worked out, for the note under the panel. */
export const VOLTAGE_NOTE = msg(
  'Freeze frames are taken only when a fault is recorded, so they are not a fair sample of the car’s life. The voltage depends first on whether the engine runs (it charges the battery), so frames with the engine running and off are kept apart, and frames from the first {seconds} seconds after a start are set aside. A trend is a Theil–Sen slope of the voltage after taking the outside temperature into account; it describes the frames, not the battery’s health.',
)
