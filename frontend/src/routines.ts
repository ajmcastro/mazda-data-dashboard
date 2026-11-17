// Pure wording of the driving routines (PLAN.md M66). No React in here.
// A routine is a kind of stretch: when it ends and how long it is. Never a place (no position is read), never a
// judgement of how the car is driven. Distances follow the reader's units; the maths stays in km.

import { msg, tr, trn } from './i18n'
import type { Routine, Routines } from './api/types'
import { fmtNum } from './lib'
import { consumptionLabel, distanceText, fmtConsumption } from './units'

const WHEN = { weekdays: msg('On weekdays'), weekends: msg('On weekends'), any: msg('Any day') }
const TIME = [
  [5, msg('in the morning')],
  [12, msg('around midday')],
  [15, msg('in the afternoon')],
  [18, msg('in the evening')],
  [22, msg('at night')],
] as const

/** Weekdays from 80% of its stretches on a weekday, weekends from 80% on a weekend, otherwise any day. */
export function whenWord(r: Pick<Routine, 'weekend_pct'>): string {
  return tr(r.weekend_pct >= 80 ? WHEN.weekends : r.weekend_pct <= 20 ? WHEN.weekdays : WHEN.any)
}

/** The part of the day of a local hour (0-24). */
export function timeWord(hour: number): string {
  let word: string = TIME[TIME.length - 1][1] // before 05:00 is still night
  for (const [from, w] of TIME) if (hour >= from) word = w
  return tr(word)
}

/** 18.7 -> "18:42". */
export function clock(hour: number): string {
  const total = Math.round(hour * 60) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const typicalKm = (r: Routine) => distanceText(r.km_median, r.km_median < 10 ? 1 : 0)

/** "On weekdays in the evening, about 6.4 km": two routines can share the days and the time but not the length. */
export const routineTitle = (r: Routine): string => tr('{when} {time}, about {km}', { when: whenWord(r), time: timeWord(r.hour), km: typicalKm(r) })

/** What a routine's stretches are like. */
export function routineLine(r: Routine): string {
  const parts = [
    tr('ending between {from} and {to}', { from: clock(r.hour_low), to: clock(r.hour_high) }),
    ...(r.minutes_median !== null && r.minutes_median !== undefined ? [tr('about {minutes} minutes of driving', { minutes: fmtNum(r.minutes_median, 0) })] : []),
    trn('{n} stretch on {days} days', '{n} stretches on {days} days', r.stretches, { days: r.days }),
    tr('{share}% of the distance', { share: fmtNum(r.km_share_pct, 0) }),
  ]
  if (r.l_per_100km !== null && r.l_per_100km !== undefined) parts.push(`${fmtConsumption(r.l_per_100km)} ${consumptionLabel()}`)
  return parts.join(' · ')
}

/** The headline of the panel. */
export function summaryLine(r: Routines | undefined): string | null {
  if (!r) return null
  if (!r.enough) return tr('Too few stretches to look for routines yet ({n} of at least 30).', { n: r.stretches })
  if (!r.clear || r.routines.length === 0) return tr('The stretches do not fall into clear routines.')
  const held = r.stretches - r.other_stretches
  return trn('1 routine holds {held} of the {total} stretches.', '{n} routines hold {held} of the {total} stretches.', r.routines.length, {
    held: fmtNum(held),
    total: fmtNum(r.stretches),
  })
}

/** The other stretches, or null when there are none. */
export function otherLine(r: Routines | undefined): string | null {
  if (!r || !r.clear || r.other_stretches === 0 || r.routines.length === 0) return null
  return trn('1 stretch fits no routine ({km}).', '{n} stretches fit no routine ({km}).', r.other_stretches, { km: distanceText(r.other_km) })
}

/**
 * For the Day page: the routine the stretch that ended at `at` was grouped into, or null. Each stretch goes to
 * the routine it is most like, so a Friday stretch can be in a routine of weekends: hence "closest".
 */
export function routineOf(at: string | null | undefined, r: Routines | undefined): string | null {
  if (!at || !r) return null
  const t = Date.parse(at)
  const member = r.members.find((m) => Date.parse(m.end_at) === t)
  const routine = member?.routine ? r.routines.find((x) => x.routine === member.routine) : undefined
  return routine ? tr('closest routine: {name}', { name: routineTitle(routine) }) : null
}

/** How routines are found, for the note under the panel. */
export const ROUTINES_NOTE = msg(
  'Learned from all the data: each stretch between two status reports less than two days apart is placed by its length, the time of day it ended (the car’s own time) and whether that was a weekend, and the stretches are grouped by k-medoids. A group is a routine when it holds at least {n} stretches on {days} different days. A routine is a kind of stretch, not a place (no position is read), and says nothing about how the car was driven.',
)
