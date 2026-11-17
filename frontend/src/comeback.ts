// Pure wording of fault comeback (PLAN.md M67). No React in here.
// It describes the read-outs: when a fault stopped being listed and when it was listed again. A return is known
// only between two read-outs, so every figure is "by the read-out of …"; never a cause or a verdict on a repair.

import { msg, tr, trn } from './i18n'
import type { Comeback, FaultComeback, ServiceEntry } from './api/types'
import { andList, fmtDate, fmtNum } from './lib'
import { kindLabel } from './service'

/** A service-log entry this many days before a wait starts is shown next to it. */
export const SERVICE_DAYS = 7

const days = (n: number) => trn('{n} day', '{n} days', Math.round(n), { n: fmtNum(Math.round(n)) })

/** The comeback of one fault, or undefined. */
export const comebackOf = (c: Comeback | undefined, ecu: string, code: string): FaultComeback | undefined =>
  c?.faults.find((f) => f.ecu === ecu && f.dtc_code === code)

/** "Listed in 30 of the unit's 43 read-outs, from 13 Jun 2026 to 1 Nov 2026." */
export function historyLine(f: FaultComeback): string {
  return tr("Listed in {listed} of the unit's {readouts} read-outs, from {first} to {last}.", {
    listed: fmtNum(f.listed),
    readouts: fmtNum(f.readouts),
    first: fmtDate(f.first_at),
    last: fmtDate(f.last_listed_at),
  })
}

/** Whether the newest read-out lists it. */
export function nowLine(f: FaultComeback): string {
  return f.listed_now
    ? tr('Listed in the unit’s newest read-out ({date}).', { date: fmtDate(f.last_read_at) })
    : tr('Not listed in the unit’s newest read-out ({date}).', { date: fmtDate(f.last_read_at) })
}

/** The times it stopped being listed and came back, in one sentence. */
export function waitsLine(f: FaultComeback): string {
  if (!f.waits.length) return tr('It has never stopped being listed.')
  const back = f.waits.filter((w) => w.back)
  const open = f.waits.find((w) => !w.back)
  const stopped = trn('It stopped being listed once', 'It stopped being listed {n} times', f.waits.length, { n: f.waits.length })
  const parts = [
    back.length
      ? tr('{stopped} and was listed again {n}: {after} later.', {
          stopped,
          n: back.length === f.waits.length ? tr('every time') : trn('once', '{n} times', back.length, { n: back.length }),
          after: andList(back.map((w) => days(w.days))),
        })
      : tr('{stopped} and has not been listed again.', { stopped }),
  ]
  // an open wait shorter than a day began at the newest read-out, which nowLine already describes
  if (open && back.length && open.days >= 1) parts.push(tr('Not listed again in the {days} since it last stopped.', { days: days(open.days) }))
  return parts.join(' ')
}

/** The Kaplan–Meier figures, or why there are none. */
export function estimateLine(f: FaultComeback, minEnded: number): string {
  if (!f.enough) return tr('Too few returns for an estimate (it needs {n}).', { n: minEnded })
  const away = f.still_away.map((s) => tr('{pct}% after {days}', { pct: fmtNum(s.pct, 0), days: days(s.days) }))
  const line = tr('Still not listed again: {list}.', { list: andList(away) })
  return f.median_days != null ? `${line} ${tr('Half were listed again within {days}.', { days: days(f.median_days) })}` : line
}

/** For a wait: the service-log entries in the week before it started ("after the oil change of 2 Jun"), or null. */
export function serviceBefore(from: string, entries: ServiceEntry[] | undefined): string | null {
  const t = Date.parse(from)
  const near = (entries ?? []).filter((e) => {
    const d = t - Date.parse(`${e.date}T12:00:00Z`)
    return d >= -86_400_000 && d <= SERVICE_DAYS * 86_400_000
  })
  if (!near.length) return null
  return tr('after the service log’s {entries}', {
    entries: andList(near.map((e) => tr('{kind} of {date}', { kind: kindLabel(e.kind), date: fmtDate(e.date) }))),
  })
}

/** One line per fault for the workshop report. */
export function reportLine(f: FaultComeback, minEnded: number): string {
  const parts = [
    tr('listed in {listed} of {readouts} read-outs', { listed: fmtNum(f.listed), readouts: fmtNum(f.readouts) }),
  ]
  const back = f.waits.filter((w) => w.back)
  if (f.waits.length) {
    parts.push(
      trn('stopped once', 'stopped {n} times', f.waits.length, { n: f.waits.length }) +
        `, ${back.length ? tr('listed again after {after}', { after: andList(back.map((w) => days(w.days))) }) : tr('not listed again')}`,
    )
  }
  if (f.enough && f.median_days != null) parts.push(tr('half back within {days}', { days: days(f.median_days) }))
  else if (back.length && !f.enough) parts.push(tr('too few returns for an estimate (it needs {n})', { n: minEnded }))
  return parts.join('; ')
}

/** How it is worked out, for the note under the panel. */
export const COMEBACK_NOTE = msg(
  'A wait starts at the first read-out of the unit that no longer lists the fault and ends at the next one that lists it again; read-outs happen only when the car is read, so it may have come back earlier. The shares still not listed again are a Kaplan–Meier estimate, which also counts the times it has not come back yet. It describes the read-outs, not a cause or whether a repair worked.',
)
