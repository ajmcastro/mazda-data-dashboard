// For the wording tests (PLAN.md M62): the same sentence in Portuguese, and the words a neutral sentence must
// not hold there either. Not imported by the apps.

import { setLang } from './index'

/** What `make` returns with Portuguese chosen; the language is put back afterwards. */
export function inPortuguese<T>(make: () => T): T {
  setLang('pt')
  try {
    return make()
  } finally {
    setLang('auto')
  }
}

/** Verdicts, orders and causes in Portuguese: what "better", "worse", "should", "because" and "broken" would be. */
export const PT_VERDICT =
  /(^|[^\p{L}])(melhor|pior|bom|boa|mau|má|maus|más|grave|perigos[oa]|urgente|deve|devia|tem de|porque|por causa|causad[oa]|culpa|defeito|estragad[oa]|desperdíci[oa]|saudável|risco)(es|s)?($|[^\p{L}])/iu

/** English left behind in a Portuguese sentence: the small words no Portuguese sentence has. */
export const ENGLISH_LEFT = /(^|[^\p{L}])(the|and|is|are|was|were|of|with|from|than|against|between|since|not|this|that|it|its|your)($|[^\p{L}])/iu
