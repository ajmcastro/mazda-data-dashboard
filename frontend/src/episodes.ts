// Pure wording of the warning episodes and patterns (PLAN.md M63). No React in here.
// A pattern says which codes usually turn up together: a hint for reading the warnings and for describing a
// code, never what a code means or why it appeared. A fault next to a pattern is a co-occurrence, never a cause.

import { msg, tr, trn } from './i18n'
import type { PatternCode, PatternFault, WarningEpisodes, WarningPattern } from './api/types'
import { andList, fmtNum } from './lib'

/** A "sometimes" code held by fewer of the pattern's episodes than this (in %) is only counted, not named. */
export const SHOWN_PCT = 10

export interface PatternCodes {
  core: PatternCode[]
  sometimes: PatternCode[]
  /** How many rarer codes were left unnamed. */
  rarer: number
}

export function patternCodes(p: WarningPattern): PatternCodes {
  const core = p.codes.filter((c) => c.role === 'core')
  const others = p.codes.filter((c) => c.role !== 'core')
  const sometimes = others.filter((c) => c.pct >= SHOWN_PCT)
  return { core, sometimes, rarer: others.length - sometimes.length }
}

/** The recurring patterns of the period, in the order the API gives (most episodes in the period first). */
export const recurring = (e: WarningEpisodes | undefined): WarningPattern[] => (e?.patterns ?? []).filter((p) => p.recurring)

/** "about 8 minutes" / "under a minute": an episode's usual length. */
export function lengthText(minutes: number): string {
  if (minutes < 1) return tr('under a minute')
  const n = Math.round(minutes)
  return trn('about 1 minute', 'about {n} minutes', n)
}

/** One line under a pattern: how often, on how many days, how long. */
export function patternLine(p: WarningPattern): string {
  const shown = trn('1 episode', '{n} episodes', p.episodes, { n: fmtNum(p.episodes) })
  const days = trn('1 day', '{n} days', p.days, { n: fmtNum(p.days) })
  const line = tr('{episodes} on {days}, usually {length}', { episodes: shown, days, length: lengthText(p.median_minutes) })
  return p.episodes_total > p.episodes
    ? `${line} ${tr('({n} in all the data)', { n: fmtNum(p.episodes_total) })}`
    : line
}

/** The headline of the panel, or null when the period has no warnings. */
export function summaryLine(e: WarningEpisodes | undefined): string | null {
  if (!e || e.episodes === 0) return null
  const pats = recurring(e)
  const held = pats.reduce((n, p) => n + p.episodes, 0)
  const parts = [
    tr('{episodes} in the period', { episodes: trn('1 episode of warnings', '{n} episodes of warnings', e.episodes, { n: fmtNum(e.episodes) }) }),
  ]
  if (pats.length) {
    parts.push(
      trn('1 recurring pattern holds {held} of them', '{n} recurring patterns hold {held} of them', pats.length, { held: fmtNum(held) }),
    )
  }
  return `${parts.join('; ')}.`
}

/** The codes left out of the grouping because nearly every episode holds them, or null when none. */
export function commonLine(e: WarningEpisodes | undefined): string | null {
  const common = e?.common ?? []
  if (!common.length) return null
  const list = andList(common.map((c) => `${c.code} (${fmtNum(c.pct, 0)}%)`))
  return trn(
    '{list} is in nearly every episode, so it is left out when comparing them.',
    '{list} are in nearly every episode, so they are left out when comparing them.',
    common.length,
    { list },
  )
}

/** What is not shown as a pattern of its own, or null. */
export function oneOffLine(e: WarningEpisodes | undefined): string | null {
  if (!e || e.one_off_episodes === 0) return null
  return trn(
    '1 episode is unlike the others and seen fewer than {min} times in all the data; it is not listed.',
    '{n} episodes are in groups seen fewer than {min} times in all the data; they are not listed.',
    e.one_off_episodes,
    { n: fmtNum(e.one_off_episodes), min: e.min_episodes },
  )
}

/**
 * "read out within a day of 3 of these 3 episodes (46% of all episodes in the period)" for a fault next to a
 * pattern: always with the share of all episodes, which is what makes it stand out.
 */
export function faultLine(f: PatternFault, total: number, hours: number): string {
  const when = hours === 24 ? tr('within a day of') : tr('within {h} hours of', { h: hours })
  return tr('read out {when} {n} of these {total} episodes ({all}% of all episodes in the period)', {
    when,
    n: fmtNum(f.episodes),
    total: fmtNum(total),
    all: fmtNum(f.pct_all, 0),
  })
}

/**
 * For a code without a description: the codes in most of the episodes that hold it ("usually with $2FE"), over
 * all the data, or null when it has none or is in too few episodes.
 */
export function codeHint(code: string, e: WarningEpisodes | undefined): string | null {
  const found = e?.companions?.find((c) => c.code === code)
  return found?.codes.length ? tr('usually with {codes}', { codes: andList(found.codes) }) : null
}

/** How episodes and patterns are made, for the note under the panel. */
export const EPISODES_NOTE = msg(
  'An episode is a run of warnings with no silence longer than {gap} minutes. Patterns are learned from all the data: episodes whose codes are alike are grouped around the sets of codes that recur most. A pattern shows which codes turn up together, not what they mean or why. A fault is listed next to a pattern only when it was read out near at least 3 of its episodes and near a clearly larger share of them than of all episodes; that is all it says.',
)
