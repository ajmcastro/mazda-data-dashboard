import { describe, expect, it } from 'vitest'
import type { WarningEpisodes, WarningPattern } from './api/types'
import { EPISODES_NOTE, codeHint, commonLine, faultLine, lengthText, oneOffLine, patternCodes, patternLine, recurring, summaryLine } from './episodes'
import { tr } from './i18n'
import { ENGLISH_LEFT, PT_VERDICT, inPortuguese } from './i18n/testing'

const pattern = (over: Partial<WarningPattern> = {}): WarningPattern => ({
  pattern: 1,
  episodes: 186,
  episodes_total: 186,
  recurring: true,
  days: 60,
  first_at: '2026-06-12T08:00:00Z',
  last_at: '2026-11-10T08:00:00Z',
  median_minutes: 8.1,
  codes: [
    { code: '$2FE', title: null, role: 'core', pct: 96.2 },
    { code: '$290', title: null, role: 'core', pct: 84.4 },
    { code: '$2CD', title: null, role: 'sometimes', pct: 54.8 },
    { code: '$182', title: null, role: 'sometimes', pct: 34.9 },
    { code: '$2DA', title: null, role: 'sometimes', pct: 4.8 },
    { code: '$187', title: null, role: 'sometimes', pct: 4.8 },
  ],
  faults: [{ ecu: 'BCM', dtc_code: 'U0198', title: null, episodes: 12, pct: 6.5, pct_all: 3.0 }],
  ...over,
})

const episodes = (patterns: WarningPattern[], over: Partial<WarningEpisodes> = {}): WarningEpisodes => ({
  gap_minutes: 10,
  min_episodes: 3,
  fault_hours: 24,
  episodes: patterns.reduce((n, p) => n + p.episodes, 0),
  recurring_patterns: patterns.filter((p) => p.recurring).length,
  one_off_episodes: patterns.filter((p) => !p.recurring).reduce((n, p) => n + p.episodes, 0),
  common: [{ code: '$210', title: null, pct: 98.4 }],
  companions: [
    { code: '$182', episodes: 83, codes: ['$2FE'] },
    { code: '$2DA', episodes: 11, codes: ['$226', '$290', '$2FE'] },
    { code: '$21D', episodes: 6, codes: [] },
  ],
  patterns,
  ...over,
})

const second = pattern({
  pattern: 2,
  episodes: 23,
  episodes_total: 23,
  days: 20,
  median_minutes: 0.4,
  codes: [
    { code: '$2CD', title: null, role: 'core', pct: 100 },
    { code: '$2FE', title: null, role: 'core', pct: 100 },
  ],
  faults: [],
})
const oneOff = pattern({ pattern: 9, episodes: 1, episodes_total: 1, recurring: false, days: 1, codes: [{ code: '$21D', title: null, role: 'core', pct: 100 }] })

describe('a pattern', () => {
  it('names its core codes and the frequent "sometimes" ones, and counts the rarer ones', () => {
    const c = patternCodes(pattern())
    expect(c.core.map((x) => x.code)).toEqual(['$2FE', '$290'])
    expect(c.sometimes.map((x) => x.code)).toEqual(['$2CD', '$182'])
    expect(c.rarer).toBe(2)
  })

  it('says how often, on how many days and how long', () => {
    expect(patternLine(pattern())).toBe('186 episodes on 60 days, usually about 8 minutes')
    expect(patternLine(pattern({ episodes: 1, days: 1, episodes_total: 6, median_minutes: 0.2 }))).toBe(
      '1 episode on 1 day, usually under a minute (6 in all the data)',
    )
    expect(lengthText(1.2)).toBe('about 1 minute')
  })

  it('words a fault next to it as a read-out near its episodes, with the share of all episodes', () => {
    const f = { ecu: 'BCM', dtc_code: 'U0198', title: null, episodes: 3, pct: 100, pct_all: 45.7 }
    expect(faultLine(f, 3, 24)).toBe('read out within a day of 3 of these 3 episodes (46% of all episodes in the period)')
    expect(faultLine(f, 5, 6)).toBe('read out within 6 hours of 3 of these 5 episodes (46% of all episodes in the period)')
  })
})

describe('the panel', () => {
  const all = episodes([pattern(), second, oneOff])

  it('lists only the recurring patterns', () => {
    expect(recurring(all).map((p) => p.pattern)).toEqual([1, 2])
    expect(recurring(undefined)).toEqual([])
  })

  it('has a headline, the common codes and what is not listed', () => {
    expect(summaryLine(all)).toBe('210 episodes of warnings in the period; 2 recurring patterns hold 209 of them.')
    expect(commonLine(all)).toBe('$210 (98%) is in nearly every episode, so it is left out when comparing them.')
    expect(oneOffLine(all)).toBe('1 episode is unlike the others and seen fewer than 3 times in all the data; it is not listed.')
  })

  it('says nothing for a period without warnings', () => {
    const none = episodes([], { common: [] })
    expect(summaryLine(none)).toBeNull()
    expect(commonLine(none)).toBeNull()
    expect(oneOffLine(none)).toBeNull()
    expect(summaryLine(undefined)).toBeNull()
  })
})

describe('a hint for an undescribed code', () => {
  const all = episodes([pattern(), second, oneOff])

  it('names the codes in most of the episodes that hold it', () => {
    expect(codeHint('$182', all)).toBe('usually with $2FE')
    expect(codeHint('$2DA', all)).toBe('usually with $226, $290 and $2FE')
  })

  it('gives nothing for a code with no companions or not listed', () => {
    expect(codeHint('$21D', all)).toBeNull()
    expect(codeHint('$999', all)).toBeNull()
    expect(codeHint('$182', undefined)).toBeNull()
  })
})

describe('the wording stays neutral', () => {
  const all = episodes([pattern(), second, oneOff])
  const english = () => [
    summaryLine(all),
    commonLine(all),
    oneOffLine(all),
    patternLine(pattern()),
    faultLine(pattern().faults[0], 186, 24),
    codeHint('$182', all),
    tr(EPISODES_NOTE, { gap: 10 }),
  ].join(' ')

  it('never gives a meaning, a cause or a verdict', () => {
    expect(english()).not.toMatch(/\b(means|caused?|because|due to|fault of|good|bad|worse|better|risk|danger|should)\b/i)
    expect(EPISODES_NOTE).toMatch(/not what they mean or why/)
  })

  it('in Portuguese too', () => {
    const pt = inPortuguese(english)
    expect(pt).not.toBe(english())
    expect(pt).not.toMatch(PT_VERDICT)
    expect(pt).not.toMatch(ENGLISH_LEFT)
  })
})
