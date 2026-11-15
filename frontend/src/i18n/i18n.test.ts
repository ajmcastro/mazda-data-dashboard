import { afterEach, describe, expect, it } from 'vitest'
import { fmtDate, fmtNum } from '../lib'
import { dayTitle } from '../day'
import { monthLabel } from '../trends'
import { en } from './en'
import { pt } from './pt'
import { LANGS, getLang, langName, locale, parseLang, setLang, t } from './index'

afterEach(() => setLang('en'))

describe('the catalogues', () => {
  it('have the same keys, and no empty phrase', () => {
    expect(Object.keys(pt).sort()).toEqual(Object.keys(en).sort())
    for (const [key, phrase] of Object.entries(pt)) expect(phrase.trim(), key).not.toBe('')
  })
  it('keep the same placeholders in both languages', () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const key of Object.keys(en) as (keyof typeof en)[]) expect(holes(pt[key]), key).toEqual(holes(en[key]))
  })
  it('are in Portuguese of Portugal', () => {
    const all = Object.values(pt).join(' ')
    expect(all).toContain('telemóvel')
    expect(all).not.toMatch(/\b(celular|tela|arquivo|usuário)\b/i) // the Brazilian forms
  })
})

describe('the language of this device', () => {
  it('is English unless Portuguese is chosen, and never guessed', () => {
    expect(getLang()).toBe('en')
    expect([parseLang('pt'), parseLang('pt-BR'), parseLang(null), parseLang('auto'), parseLang('fr')]).toEqual(['pt', 'en', 'en', 'en', 'en'])
    expect(LANGS).toEqual(['en', 'pt'])
    expect([langName('en'), langName('pt')]).toEqual(['English', 'Português'])
  })
  it('translates a phrase and fills its placeholders', () => {
    expect(t('nav.faults')).toBe('Faults')
    expect(t('common.newAlerts', { n: 3 })).toBe('3 new alerts')
    setLang('pt')
    expect(t('nav.faults')).toBe('Avarias')
    expect(t('common.newAlerts', { n: 3 })).toBe('3 alertas novos')
    expect(t('common.newAlerts')).toBe('{n} alertas novos') // nothing to fill it with: left as it is
  })
  it('formats numbers and dates in the chosen language, and switching back is exact', () => {
    const before = [fmtNum(1234.5, 1), fmtDate('2026-06-27'), dayTitle('2026-06-27'), monthLabel('2026-05')]
    expect(locale()).toBe('en-GB')
    setLang('pt')
    expect(locale()).toBe('pt-PT')
    expect(fmtDate('2026-06-27')).toMatch(/^27\/06\/2026$|27.*jun.*2026/i) // Portugal writes short dates with figures
    expect(dayTitle('2026-06-27')).toMatch(/^sábado, 27 de junho de 2026$/i)
    expect(monthLabel('2026-05')).toMatch(/mai|05\/2026/i)
    expect(fmtNum(1234.5, 1)).toMatch(/1.?234,5/)
    setLang('en')
    expect([fmtNum(1234.5, 1), fmtDate('2026-06-27'), dayTitle('2026-06-27'), monthLabel('2026-05')]).toEqual(before)
    expect(dayTitle('2026-06-27')).toBe('Saturday, 27 June 2026')
  })
})
