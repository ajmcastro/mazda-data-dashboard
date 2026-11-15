// A second language (PLAN.md M62, started): a typed catalogue, `t()`, and the language chosen per device.
// No library and no outside request. **English is the default and stays it until the translation is complete**:
// only what has a key in `en.ts` is translated, so Portuguese is offered as "in progress" and never picked
// automatically from the browser.

import { useSyncExternalStore } from 'react'
import { en, type Key } from './en'
import { pt } from './pt'

export type Lang = 'en' | 'pt'
export const LANGS: readonly Lang[] = ['en', 'pt']
export const LANG_KEY = 'cx5.lang'
const CATALOGUE: Record<Lang, Record<Key, string>> = { en, pt }
const LOCALE: Record<Lang, string> = { en: 'en-GB', pt: 'pt-PT' }

export const parseLang = (value: unknown): Lang => (value === 'pt' ? 'pt' : 'en')

function saved(): Lang {
  try {
    return typeof localStorage === 'undefined' ? 'en' : parseLang(localStorage.getItem(LANG_KEY))
  } catch {
    return 'en'
  }
}

let current: Lang = saved()
if (typeof document !== 'undefined') document.documentElement.lang = current
const listeners = new Set<() => void>()

export const getLang = (): Lang => current
/** The locale numbers and dates are formatted in. */
export const locale = (): string => LOCALE[current]

export function setLang(next: Lang): void {
  current = next
  try {
    localStorage.setItem(LANG_KEY, next)
  } catch {
    /* not remembered */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = next
  for (const l of listeners) l()
}

/** The language of this device; the component is drawn again when it changes. */
export function useLang(): [Lang, (next: Lang) => void] {
  const lang = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    getLang,
    getLang,
  )
  return [lang, setLang]
}

/** A phrase in the chosen language; `{name}` placeholders are filled from `params`. */
export function t(key: Key, params?: Record<string, string | number>): string {
  const phrase = CATALOGUE[current][key] ?? en[key]
  return params ? phrase.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole)) : phrase
}

/** The name of a language in that language ("English", "Português"). */
export const langName = (lang: Lang): string => CATALOGUE[lang]['lang.name']
