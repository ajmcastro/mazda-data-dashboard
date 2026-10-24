/** JSON comparison for the contract tests: exact except floats (tiny relative tolerance), key order ignored. */

export function diff(expected: unknown, actual: unknown, at = '$'): string | null {
  if (typeof expected === 'number' && typeof actual === 'number') {
    const tol = 1e-9 * Math.max(1, Math.abs(expected), Math.abs(actual))
    return Math.abs(expected - actual) <= tol ? null : `${at}: expected ${expected}, got ${actual}`
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return `${at}: expected ${kind(expected)}, got ${kind(actual)}`
    if (expected.length !== actual.length) return `${at}: expected ${expected.length} items, got ${actual.length}`
    for (let i = 0; i < expected.length; i++) {
      const d = diff(expected[i], actual[i], `${at}[${i}]`)
      if (d) return d
    }
    return null
  }
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    const e = expected as Record<string, unknown>
    const a = actual as Record<string, unknown>
    const keys = new Set([...Object.keys(e), ...Object.keys(a)])
    for (const k of [...keys].sort()) {
      if (!(k in e)) return `${at}.${k}: unexpected field`
      if (!(k in a)) return `${at}.${k}: missing field`
      const d = diff(e[k], a[k], `${at}.${k}`)
      if (d) return d
    }
    return null
  }
  return expected === actual ? null : `${at}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
}

const kind = (v: unknown) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v)

/** Same normalisation the Python recorder applies (see `_normalise` in contract.py). */
export function normalise(body: unknown): unknown {
  if (Array.isArray(body)) return body.map(normalise)
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>
    if (Array.isArray(o.detail)) return { detail: '<validation>' }
    return Object.fromEntries(
      Object.entries(o).map(([k, v]) => [k, k === 'acknowledged_at' && v !== null ? '<now>' : normalise(v)]),
    )
  }
  return body
}
