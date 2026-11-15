// A second language (PLAN.md M62): a typed catalogue for the menus (`t()`), the phrases of everything else
// (`tr()`, `trn()`, `msg()`: the English text is the key, Portuguese in `pt/`), and the language chosen per
// device. No library and no outside request. The choice is Auto (the browser's language: Portuguese when it
// asks for Portuguese before English, English otherwise), English or Portuguese.

import { useSyncExternalStore } from 'react'
import { en, type Key } from './en'
import { pt } from './pt'
import { PHRASES } from './pt/index'

export type Lang = 'en' | 'pt'
export const LANGS: readonly Lang[] = ['en', 'pt']
export const LANG_KEY = 'cx5.lang'
const CATALOGUE: Record<Lang, Record<Key, string>> = { en, pt }
const LOCALE: Record<Lang, string> = { en: 'en-GB', pt: 'pt-PT' }

/** What the reader chose: a language, or to follow the browser. */
export type LangChoice = Lang | 'auto'
export const CHOICES: readonly LangChoice[] = ['auto', 'en', 'pt']

export const parseLang = (value: unknown): Lang => (value === 'pt' ? 'pt' : 'en')
export const parseChoice = (value: unknown): LangChoice => (value === 'pt' || value === 'en' ? value : 'auto')

/** The language a browser asks for: the first of its languages that is one of ours (any Portuguese, any English). */
export function fromBrowser(languages: readonly string[]): Lang {
  for (const tag of languages) {
    if (/^pt\b/i.test(tag)) return 'pt'
    if (/^en\b/i.test(tag)) return 'en'
  }
  return 'en'
}

/** The browser's languages; none outside a browser (tests, a build), so Auto is English there. */
function browserLanguages(): readonly string[] {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return []
  return navigator.languages?.length ? navigator.languages : [navigator.language]
}

export const resolveLang = (choice: LangChoice, languages: readonly string[] = browserLanguages()): Lang =>
  choice === 'auto' ? fromBrowser(languages) : choice

function saved(): LangChoice {
  try {
    return typeof localStorage === 'undefined' ? 'auto' : parseChoice(localStorage.getItem(LANG_KEY))
  } catch {
    return 'auto'
  }
}

let choice: LangChoice = saved()
let current: Lang = resolveLang(choice)
if (typeof document !== 'undefined') document.documentElement.lang = current
const listeners = new Set<() => void>()

export const getLang = (): Lang => current
/** The locale numbers and dates are formatted in. */
export const locale = (): string => LOCALE[current]

export const getChoice = (): LangChoice => choice

export function setLang(next: LangChoice): void {
  choice = next
  current = resolveLang(next)
  try {
    localStorage.setItem(LANG_KEY, next)
  } catch {
    /* not remembered */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = current
  for (const l of listeners) l()
}

const subscribe = (onChange: () => void) => {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

/** The language of this device; the component is drawn again when it changes. */
export function useLang(): [Lang, (next: LangChoice) => void] {
  return [useSyncExternalStore(subscribe, getLang, getLang), setLang]
}

/** What was chosen (Auto, or a language), for the control that changes it. */
export const useLangChoice = (): LangChoice => useSyncExternalStore(subscribe, getChoice, getChoice)

/** A phrase in the chosen language; `{name}` placeholders are filled from `params`. */
export function t(key: Key, params?: Record<string, string | number>): string {
  const phrase = CATALOGUE[current][key] ?? en[key]
  return params ? phrase.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole)) : phrase
}

/** The name of a language in that language ("English", "Português"). */
export const langName = (lang: Lang): string => CATALOGUE[lang]['lang.name']

// ---------------------------------------------------------------- phrases

const fill = (phrase: string, params?: Record<string, string | number>): string =>
  params ? phrase.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole)) : phrase

/**
 * A phrase of the interface: the English text itself is the key, so in English nothing changes and every test
 * that asserts English wording still holds. In Portuguese it is looked up in `pt/`; a phrase with no entry
 * there fails a source test (`phrases.test.ts`) rather than showing English silently. `{name}` is filled from
 * `params` after the lookup.
 */
export function tr(text: string, params?: Record<string, string | number>): string {
  return fill(current === 'pt' ? (PHRASES[text] ?? text) : text, params)
}

/** `tr` for a count: `one` when n is 1, `many` otherwise (the rule English and Portuguese share); `{n}` is filled. */
export function trn(one: string, many: string, n: number, params?: Record<string, string | number>): string {
  return tr(n === 1 ? one : many, { n, ...params })
}

/**
 * Marks a phrase that is kept in a constant and translated where it is shown (`tr(value)`): a constant is made
 * once, when the file loads, so it must stay English there. The source test requires an entry for it too.
 */
export const msg = (text: string): string => text
