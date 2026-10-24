/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { nextTheme, parseTheme, THEME_ORDER } from './theme'

describe('theme choice', () => {
  it('only dark and light are remembered, anything else means follow the device', () => {
    expect(parseTheme('dark')).toBe('dark')
    expect(parseTheme('light')).toBe('light')
    for (const v of ['auto', '', null, undefined, 'DARK', 'blue', 3]) expect(parseTheme(v)).toBe('auto')
  })

  it('the button cycles Auto, Dark, Light and back', () => {
    expect(THEME_ORDER).toEqual(['auto', 'dark', 'light'])
    expect(nextTheme('auto')).toBe('dark')
    expect(nextTheme('dark')).toBe('light')
    expect(nextTheme('light')).toBe('auto')
  })
})

describe('index.css themes', () => {
  // read from disk: vitest replaces imported CSS with an empty string
  const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
  const vars = (block: string) =>
    [...block.matchAll(/(--[\w-]+|color-scheme):\s*([^;]+);/g)].map((m) => `${m[1]}:${m[2].trim()}`).sort()

  it('the forced-light and the automatic-light palettes are the same', () => {
    const forced = /:root\[data-theme='light'\]\s*\{([^}]*)\}/.exec(css)?.[1]
    const auto = /@media \(prefers-color-scheme: light\)\s*\{\s*:root:not\(\[data-theme='dark'\]\)\s*\{([^}]*)\}/.exec(css)?.[1]
    expect(forced).toBeTruthy()
    expect(auto).toBeTruthy()
    expect(vars(forced!)).toEqual(vars(auto!))
    expect(vars(forced!).length).toBeGreaterThan(10)
  })

  it('the light and dark palettes define the same variables', () => {
    const dark = /^:root\s*\{([^}]*)\}/m.exec(css)?.[1]
    const light = /:root\[data-theme='light'\]\s*\{([^}]*)\}/.exec(css)?.[1]
    const names = (b: string) => vars(b).map((v) => v.split(':')[0]).filter((n) => n.startsWith('--') && !['--display', '--body', '--mono', '--radius'].includes(n))
    expect(names(light!)).toEqual(names(dark!).filter((n) => names(light!).includes(n)))
    expect(names(light!).length).toBeGreaterThan(10)
  })
})
