import { afterEach, describe, expect, it } from 'vitest'
import type { ImportSummary } from './api/types'
import { IMPORT_NOTES, changeLines, changedAnything, filesLine, headline, looksImportable } from './imports'
import { fmtDate, fmtNum } from './lib'
import { DEFAULT_UNITS, setUnits } from './units'
import { ENGLISH_LEFT, PT_VERDICT, inPortuguese } from './i18n/testing'
import { tr } from './i18n'

afterEach(() => setUnits(DEFAULT_UNITS))

const file = (kind: string, status = 'added') => ({ name: `all_${kind}-x.csv`, kind, status, saved_as: status === 'added' ? `all_${kind}-x.csv` : null })
const s = (over: Partial<ImportSummary> = {}): ImportSummary => ({
  imported_at: '2026-11-15T08:00:00Z', source: 'mazda-export.zip', files: [file('war'), file('rts'), file('alt', 'already there')],
  rows_new: [{ kind: 'war', label: 'warnings', rows: 1200 }, { kind: 'rts', label: 'status reports', rows: 4310 }],
  newest_day_before: '2026-10-20', newest_day_after: '2026-11-10', km_since: 812.4,
  faults_appeared: ['U2701'], faults_cleared: ['P0562'], new_warning_codes: ['$4E9', '$3A0'],
  new_alerts: ['New fault U2701', 'Low tire pressure (rear left): 190 kPa'], open_alerts: 5, ...over,
})
const nothing = s({
  files: [file('war', 'already there'), file('rts', 'already there')], rows_new: [], newest_day_before: '2026-11-10', km_since: 0,
  faults_appeared: [], faults_cleared: [], new_warning_codes: [], new_alerts: [],
})

describe('what the browser may offer', () => {
  it('is the zip or one of the export files, by name', () => {
    for (const ok of ['Mazda.ZIP', 'all-war-24pf_war-24pf.csv', 'all-dtc-ssr-24pf_dtc-ssr-24pf.csv', 'all-24pf-diag-tool_x.txt']) {
      expect(looksImportable(ok), ok).toBe(true)
    }
    for (const no of ['notes.txt', 'photo.jpg', 'war.csv', 'settings.yaml']) expect(looksImportable(no), no).toBe(false)
  })
})

describe('one load in words', () => {
  it('counts the files that were new and those already loaded', () => {
    expect(filesLine(s())).toBe('2 files added, 1 already loaded.')
    expect(filesLine(s({ files: [file('war')] }))).toBe('1 file added.')
    expect(filesLine(nothing)).toBe('Nothing new: all 2 files were already loaded.')
    expect(filesLine(s({ files: [file('war', 'already there')], rows_new: [] }))).toBe('Nothing new: the file was already loaded.')
    // a file stored by a load that did not finish: nothing new to store, but its rows come in now
    expect(filesLine(s({ files: [file('war', 'already there')] }))).toBe('No new file, but rows that were not loaded yet were added.')
    expect(changedAnything(s({ files: [file('war', 'already there')] }))).toBe(true)
  })
  it('says what changed, one fact per line', () => {
    expect(changeLines(s())).toEqual([
      `New rows: ${fmtNum(1200)} warnings, ${fmtNum(4310)} status reports.`,
      `The data now reaches ${fmtDate('2026-11-10')} (it reached ${fmtDate('2026-10-20')}).`,
      '812 km driven since the load before.',
      'In the latest fault read-out and not before: U2701.',
      'No longer in the latest fault read-out: P0562.',
      '2 warning codes not seen before: $4E9, $3A0.',
      '2 new alerts: New fault U2701; Low tire pressure (rear left): 190 kPa.',
    ])
  })
  it('says nothing about what did not change, and words a first load', () => {
    expect(changeLines(nothing)).toEqual([])
    expect(changedAnything(nothing)).toBe(false)
    expect(changedAnything(s())).toBe(true)
    expect(changeLines(s({ newest_day_before: null, km_since: null }))[1]).toBe(`The data runs to ${fmtDate('2026-11-10')}.`)
  })
  it('follows the reader\'s distance unit', () => {
    setUnits({ ...DEFAULT_UNITS, distance: 'mi' })
    expect(changeLines(s())[2]).toBe('505 mi driven since the load before.')
  })
  it('has a short form for the Overview', () => {
    expect(headline(s())).toBe('Imported mazda-export.zip: 2 files added, 1 already loaded. 2 new alerts.')
    expect(headline(nothing)).toBe('Imported mazda-export.zip: nothing new, all 2 files were already loaded.')
  })
  it('reports and never interprets', () => {
    const text = [...changeLines(s()), ...IMPORT_NOTES].join(' ')
    expect(text).not.toMatch(/\b(serious|dangerous|urgent|you should|must)\b/i)
    const portuguese = inPortuguese(() => [...changeLines(s()), ...IMPORT_NOTES.map((note) => tr(note))].join(' '))
    expect(portuguese).not.toBe(text)
    expect(portuguese).not.toMatch(PT_VERDICT)
    expect(portuguese).not.toMatch(ENGLISH_LEFT)
    expect(text).toContain('Nothing leaves this computer')
  })
})
