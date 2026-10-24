/** Request plumbing: error type, query-string validation (what FastAPI does for the Python API). */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
  ) {
    super(typeof detail === 'string' ? detail : `HTTP ${status}`)
  }
}

/** FastAPI-shaped validation error (the exact structure is not part of the contract). */
export function invalid(name: string, msg: string): HttpError {
  return new HttpError(422, [{ type: 'value_error', loc: ['query', name], msg }])
}

export class Query {
  constructor(private readonly sp: URLSearchParams) {}

  private raw(name: string): string | undefined {
    return this.sp.getAll(name).at(-1)
  }

  /** Optional string (empty counts as given, like FastAPI). */
  str(name: string): string | undefined {
    return this.raw(name)
  }

  required(name: string): string {
    const v = this.raw(name)
    if (v === undefined) throw new HttpError(422, [{ type: 'missing', loc: ['query', name], msg: 'Field required' }])
    return v
  }

  int(name: string, def: number, min?: number, max?: number): number {
    const v = this.raw(name)
    if (v === undefined) return def
    if (!/^[+-]?\d+$/.test(v.trim())) throw invalid(name, 'Input should be a valid integer')
    const n = Number(v)
    if (min !== undefined && n < min) throw invalid(name, `Input should be greater than or equal to ${min}`)
    if (max !== undefined && n > max) throw invalid(name, `Input should be less than or equal to ${max}`)
    return n
  }

  /** Float with an exclusive lower bound (`gt`) and inclusive upper bound (`le`). */
  float(name: string, def: number, gt: number, le: number): number {
    const v = this.raw(name)
    if (v === undefined) return def
    if (v.trim() === '' || !Number.isFinite(Number(v))) throw invalid(name, 'Input should be a valid number')
    const n = Number(v)
    if (!(n > gt)) throw invalid(name, `Input should be greater than ${gt}`)
    if (n > le) throw invalid(name, `Input should be less than or equal to ${le}`)
    return n
  }

  oneOf<T extends string>(name: string, allowed: readonly T[], def: T): T {
    const v = this.raw(name)
    if (v === undefined) return def
    if (!(allowed as readonly string[]).includes(v)) throw invalid(name, `Input should be ${allowed.map((a) => `'${a}'`).join(', ')}`)
    return v as T
  }
}

/** Keeps the listed fields in order and fills the missing ones with null (what a Pydantic model does). */
export function pick(row: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) out[f] = row[f] ?? null
  return out
}
