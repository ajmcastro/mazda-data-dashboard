import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { setLang, tr, trn } from './index'
import { PHRASES } from './pt/index'

afterEach(() => setLang('en'))

const here = fileURLToPath(new URL('.', import.meta.url))
const roots = [join(here, '..'), join(here, '../../../mobile/src')]
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'i18n' || name === 'engine' ? [] : walk(path)
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) && name !== 'schema.d.ts' ? [path] : []
  })
const files = roots.flatMap((root) => walk(root).map((path) => ({ rel: relative(join(here, '../../..'), path), text: readFileSync(path, 'utf8') })))

/** A string literal as the code means it (the three quote styles; a template with ${} is not a phrase key). */
const LITERAL = String.raw`'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|` + '`((?:[^`\\\\$]|\\\\.)*)`'
const unescape = (raw: string) => raw.replace(/\\(['"`\\n])/g, (_, c: string) => (c === 'n' ? '\n' : c))

function phrasesIn(text: string): string[] {
  const out: string[] = []
  const call = new RegExp(String.raw`\b(?:tr|msg)\(\s*(?:${LITERAL})`, 'g')
  for (const m of text.matchAll(call)) out.push(unescape(m[1] ?? m[2] ?? m[3]))
  const count = new RegExp(String.raw`\btrn\(\s*(?:${LITERAL})\s*,\s*(?:${LITERAL})`, 'g')
  for (const m of text.matchAll(count)) out.push(unescape(m[1] ?? m[2] ?? m[3]), unescape(m[4] ?? m[5] ?? m[6]))
  return out
}

describe('every phrase of the interface', () => {
  const used = new Map<string, string>() // phrase -> a file that uses it
  for (const f of files) for (const phrase of phrasesIn(f.text)) if (!used.has(phrase)) used.set(phrase, f.rel)

  it('is found by this test at all', () => {
    expect(phrasesIn("x = tr('It\\'s {n}', { n })\ny = trn(\"1 day\", `{n} days`, n)\nz = msg('Kept')")).toEqual(["It's {n}", 'Kept', '1 day', '{n} days'])
  })
  it('has a Portuguese text', () => {
    const missing = [...used].filter(([phrase]) => !(phrase in PHRASES)).map(([phrase, rel]) => `${rel}: ${phrase}`)
    expect(missing).toEqual([])
  })
  it('keeps its {placeholders} in Portuguese', () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    const wrong = Object.entries(PHRASES).filter(([english, portuguese]) => holes(english).join() !== holes(portuguese).join()).map(([english]) => english)
    expect(wrong).toEqual([])
  })
  it('is written once: the same phrase in two area files would let one silently win', () => {
    const dir = join(here, 'pt')
    const seen = new Map<string, string>()
    const twice: string[] = []
    for (const name of readdirSync(dir).filter((n) => n !== 'index.ts')) {
      for (const m of readFileSync(join(dir, name), 'utf8').matchAll(/^ {2}('(?:[^'\\]|\\.)*'): /gm)) {
        if (seen.has(m[1])) twice.push(`${m[1]} in ${seen.get(m[1])} and ${name}`)
        seen.set(m[1], name)
      }
    }
    expect(seen.size).toBeGreaterThan(500)
    expect(twice).toEqual([])
  })
  it('has no Portuguese text that nothing uses, and none left empty', () => {
    expect(Object.keys(PHRASES).filter((phrase) => !used.has(phrase))).toEqual([])
    expect(Object.entries(PHRASES).filter(([, portuguese]) => portuguese.trim() === '').map(([english]) => english)).toEqual([])
  })
})

describe('the screens', () => {
  // text a reader would see that was typed straight into the markup, so it could never be translated
  const bare = (text: string): string[] => {
    const out: string[] = []
    text.split('\n').forEach((line, i) => {
      const code = line.trim()
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return
      // words between two tags, outside {braces}; file names, commands and codes in a mono span or <code> stay
      for (const m of code.matchAll(/>([^<>{}]*[A-Za-z]{2}[^<>{}]*)</g)) {
        const before = code.slice(0, m.index)
        if (/<(code|span className="mono")$/.test(before) || /=\s*$|=>\s*$|\?\s*$|&&\s*$/.test(before)) continue
        if (/&&|\|\||;|=/.test(m[1])) continue // code between a comparison and a tag, not text
        if (/[A-Za-z]{2,}/.test(m[1]) && !/^[\s\d%.,:;()·/*–-]*$/.test(m[1])) out.push(`${i + 1}: ${m[1].trim()}`)
      }
      // a line that is nothing but words (text of an element opened on the line above)
      if (/^[A-Z][A-Za-z']+( [A-Za-z(“][^<>=]*)?$/.test(code) && !/;$/.test(code) && / /.test(code) && !/[{}]\s*$/.test(code.replace(/\{[^{}]*\}/g, '')) && !/^(Area|Bar|Line|Cell|Tooltip)\b|,$/.test(code)) out.push(`${i + 1}: ${code}`)
      for (const m of code.matchAll(/\b(?:title|aria-label|placeholder|hint|alt|label)="([^"]*[A-Za-z]{2}[^"]*)"/g)) out.push(`${i + 1}: ${m[1]}`)
    })
    return out
  }
  it('are found by this test at all', () => {
    expect(bare('<p>Hello there</p>\n<b title="A tip">{x}</b>\n<span className="mono">make ingest</span>\n<p>{tr(\'Fine\')}</p>\n<button>\n  Save it ({n})\n</button>')).toEqual(['1: Hello there', '2: A tip', '6: Save it ({n})'])
  })
  it('hold no text typed straight into the markup', () => {
    const found = files.filter((f) => f.rel.endsWith('.tsx')).flatMap((f) => bare(f.text).map((hit) => `${f.rel}:${hit}`))
    expect(found).toEqual([])
  })
})

describe('tr and trn', () => {
  it('leave English exactly as written and fill the placeholders', () => {
    expect(tr('Anything at all, {n} of it', { n: 3 })).toBe('Anything at all, 3 of it')
    expect(trn('1 thing', '{n} things', 1)).toBe('1 thing')
    expect(trn('1 thing', '{n} things', 4)).toBe('4 things')
  })
  it('fall back to English for a phrase without an entry (which the test above forbids)', () => {
    setLang('pt')
    expect(tr('A phrase nobody translated')).toBe('A phrase nobody translated')
  })
})
