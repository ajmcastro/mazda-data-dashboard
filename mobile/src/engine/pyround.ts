/** Python's `round(x, n)`: the nearest value of the exact binary number, ties to even (JS `Math.round` differs on both counts). */
export function pyRound(x: number, digits: number): number {
  if (!Number.isFinite(x)) return x
  // `toFixed` rounds the exact value of the double (not the shortest decimal), but sends ties up.
  // A tie is when the exact expansion is d.dd5000... with nothing after the 5.
  const exact = Math.abs(x).toFixed(digits + 30)
  const frac = exact.slice(exact.indexOf('.') + 1)
  if (frac[digits] === '5' && /^0*$/.test(frac.slice(digits + 1))) {
    const kept = exact.slice(0, exact.indexOf('.') + 1 + digits) // truncated to `digits` places
    const last = Number(kept.replace('.', '').slice(-1))
    const down = Number(kept)
    const step = 10 ** -digits
    const result = last % 2 === 0 ? down : down + step
    return Math.sign(x) * Number(result.toFixed(digits))
  }
  return Number(x.toFixed(digits))
}
