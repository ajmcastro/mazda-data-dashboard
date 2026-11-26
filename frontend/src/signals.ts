// What the values of some signals mean, as Mazda documents them for a model's platform (PLAN.md M72). The
// table comes from `GET /api/signals/values` (config/platforms/<platform>/signal_values.yaml); a model whose
// platform has none gets an empty answer and every page keeps showing the raw number. Pure, no React.

import { msg, tr } from './i18n'
import type { SignalValues } from './api/types'
import { fmtNum } from './lib'

export type SignalState = 'ok' | 'info' | 'attention' | 'unknown'

export interface Meaning {
  /** The documented label, in the reader's language. */
  label: string
  state: SignalState
}

/** The documented values by `signal:value`, as the API gave them (labels in English). */
export type Meanings = ReadonlyMap<string, { label: string; state: SignalState }>

const STATES: readonly SignalState[] = ['ok', 'info', 'attention', 'unknown']

/** Every label of the platform files, so each has its Portuguese (a test reads the YAML files). */
export const SIGNAL_LABELS = [
  msg('Ready'), msg('Cranking'), msg('Running'), msg('Stop-start: about to stop'), msg('Stop-start: stopping'),
  msg('Stopped by stop-start'), msg('Stop-start: ready to restart'), msg('Stop-start: restarting'),
  msg('Running with stop-start on'), msg('Unknown'), msg('Empty'), msg('Occupied'), msg('Malfunction'), msg('Normal'),
  msg('Low'), msg('Over the high mark'), msg('Not used'), msg('Failure'), msg('Reserved'), msg('No failure'),
  msg('Signal missing'), msg('Signal missing with an error'), msg('Sensor battery low'), msg('Control unit failure'),
  msg('Repeated errors'), msg('Not available'), msg('Off'), msg('On without a chime'), msg('On with a chime'),
  msg('On with the chime off'), msg('On'), msg('Flashing'), msg('Unlocked'), msg('Neutral'), msg('Locked'),
  msg('Off while driving'), msg('Not set'), msg('Setting'), msg('Armed'), msg('Armed with the trunk open'),
  msg('Alarm sounding'), msg('Pause between alarms'), msg('No cause'), msg('Door'), msg('Trunk'), msg('Hood'),
  msg('Battery removed'), msg('Intrusion'), msg('Tilt'), msg('Glass breakage'), msg('Ignition on'),
] as const

const key = (signal: string, value: number) => `${signal}:${value}`

/** The table of an answer (an empty one while it loads, for a model without documented values, or on an
 *  error: the pages then show raw numbers, as before). A state the page does not know is left out. */
export function meanings(answer: SignalValues | undefined): Meanings {
  const out = new Map<string, { label: string; state: SignalState }>()
  for (const v of answer?.values ?? []) {
    if ((STATES as readonly string[]).includes(v.state)) out.set(key(v.signal, v.value), { label: v.label, state: v.state as SignalState })
  }
  return out
}

/** Whether the table documents this signal at all. */
export const documents = (m: Meanings | undefined, signal: string): boolean =>
  !!m && [...m.keys()].some((k) => k.startsWith(`${signal}:`))

/** What a value means, translated; null when the value is missing or not documented. */
export function meaningOf(m: Meanings | undefined, signal: string, value: number | null | undefined): Meaning | null {
  if (!m || typeof value !== 'number' || Number.isNaN(value)) return null
  const found = m.get(key(signal, value))
  return found ? { label: tr(found.label), state: found.state } : null
}

/** The value in words when it is documented, the raw number otherwise ("–" when missing). */
export const valueText = (m: Meanings | undefined, signal: string, value: number | null | undefined): string =>
  meaningOf(m, signal, value)?.label ?? fmtNum(value)

/** The engine state as a note for the car view and the Day page; null without a documented value. */
export function engineStateNote(m: Meanings | undefined, value: number | null | undefined): string | null {
  const meaning = meaningOf(m, 'enginestate', value)
  return meaning ? tr('engine: {state}', { state: meaning.label.toLowerCase() }) : null
}

/** An alarm reading in words: the burglar status and, when there is one, the reason. Raw numbers for a
 *  platform without documented values, as before. */
export function alarmText(m: Meanings | undefined, status: number | null | undefined, reason: number | null | undefined): string {
  const st = meaningOf(m, 'burglarstatus', status)
  const rs = meaningOf(m, 'balarmreasondactl', reason)
  if (!st && !rs) return tr('status {status}, reason {reason}', { status: fmtNum(status), reason: fmtNum(reason) })
  const what = st?.label ?? tr('status {status}', { status: fmtNum(status) })
  if (typeof reason !== 'number' || reason === 0) return what
  return tr('{status}, reason: {reason}', { status: what, reason: (rs?.label ?? fmtNum(reason)).toLowerCase() })
}

/** Where a seat sensor is, in words (the API names the seats). */
export const SEAT_NAMES: Record<string, string> = {
  passenger: msg('Front passenger'), rear_left: msg('Rear left'), rear_center: msg('Rear centre'), rear_right: msg('Rear right'),
}
