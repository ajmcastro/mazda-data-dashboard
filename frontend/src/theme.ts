/**
 * Appearance: follow the device (default) or force dark / light. The choice is kept in
 * localStorage and applied as `data-theme` on <html>; with no attribute the CSS follows
 * `prefers-color-scheme`. index.html applies a saved choice before the first paint, this module
 * keeps it in step afterwards (and the browser's address-bar colour).
 */
import { useSyncExternalStore } from 'react'

export type ThemeChoice = 'auto' | 'dark' | 'light'

export const THEME_KEY = 'cx5.theme'
export const THEME_ORDER: readonly ThemeChoice[] = ['auto', 'dark', 'light']
export const THEME_LABEL: Record<ThemeChoice, string> = { auto: 'Auto', dark: 'Dark', light: 'Light' }
/** The page background of each theme (browser chrome colour, see `--bg` in index.css). */
export const THEME_COLOR = { dark: '#0d0e10', light: '#efebe3' } as const

export function parseTheme(value: unknown): ThemeChoice {
  return value === 'dark' || value === 'light' ? value : 'auto'
}

/** The next choice when the button is tapped: Auto, Dark, Light, Auto ... */
export function nextTheme(current: ThemeChoice): ThemeChoice {
  return THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length]
}

function read(): ThemeChoice {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY))
  } catch {
    return 'auto' // storage blocked (private mode): the choice just lasts for this visit
  }
}

let current: ThemeChoice = read()
const listeners = new Set<() => void>()

/** Puts a choice on the page: the attribute for the CSS and the address-bar colour. */
export function applyTheme(choice: ThemeChoice): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (choice === 'auto') delete root.dataset.theme
  else root.dataset.theme = choice
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const media = meta.getAttribute('media') ?? ''
    const own = media.includes('light') ? THEME_COLOR.light : THEME_COLOR.dark
    meta.content = choice === 'auto' ? own : THEME_COLOR[choice]
  }
}

export function setTheme(choice: ThemeChoice): void {
  current = choice
  try {
    if (choice === 'auto') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, choice)
  } catch {
    /* not remembered */
  }
  applyTheme(choice)
  listeners.forEach((fn) => fn())
}

/** Call once at start-up (index.html already did the visible part). */
export function initTheme(): void {
  current = read()
  applyTheme(current)
}

export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const choice = useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => current,
  )
  return [choice, setTheme]
}
