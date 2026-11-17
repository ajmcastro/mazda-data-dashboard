/**
 * Next month at this pace (port of `api/month.py`, PLAN.md M71): the next 30 days' distance, fuel and estimated
 * cost as a range, by a block bootstrap of the car's last 90 days with the same Park-Miller sequence (integers
 * only, exact in a double). The same SQL and arithmetic in the same order: keep the two identical.
 */
import type { Handler } from './context'
import { changePoints } from './changes'
import { pyRound } from './pyround'

const WINDOW_DAYS = 90
const MONTH_DAYS = 30
const BLOCK_DAYS = 7
const REPLICATES = 1000
const MIN_DAYS = 30
const SEED = 1
const MODULUS = 2147483647
const MULTIPLIER = 16807

const DAILY_SQL =
  'SELECT day, km_since_previous AS km FROM v_odometer_daily ' +
  `WHERE day > CAST(? AS DATE) - INTERVAL ${WINDOW_DAYS} DAY AND day <= CAST(? AS DATE) AND km_since_previous IS NOT NULL ` +
  'ORDER BY day'
const FUEL_SQL =
  'SELECT sum(fuel_l) AS fuel_l, sum(km) AS km FROM v_trip_segments ' +
  'WHERE fuel_l IS NOT NULL AND km > 0 AND end_at >= CAST(? AS TIMESTAMP) AND CAST(end_at AS DATE) <= CAST(? AS DATE)'
const PRICE_SQL = 'SELECT per_l FROM v_fuel_prices WHERE valid_from <= CAST(? AS DATE) ' + 'ORDER BY valid_from DESC LIMIT 1'

const DAY = 86_400_000
const dayOf = (v: unknown) => String(v).slice(0, 10)
const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY)

export function percentile(sorted: number[], q: number): number {
  return sorted[Math.floor(q * (sorted.length - 1))]
}

export function bootstrap(daily: number[]): number[] {
  const starts = daily.length - BLOCK_DAYS + 1
  let x = SEED
  const out: number[] = []
  for (let r = 0; r < REPLICATES; r++) {
    const month: number[] = []
    while (month.length < MONTH_DAYS) {
      x = (x * MULTIPLIER) % MODULUS
      const s = x % starts
      month.push(...daily.slice(s, s + BLOCK_DAYS))
    }
    let total = 0.0
    for (const v of month.slice(0, MONTH_DAYS)) total += v
    out.push(total)
  }
  return out.sort((a, b) => a - b)
}

const r = (v: number | null, digits: number) => (v === null ? null : pyRound(v, digits))

export const monthForecast: Handler = async (ctx) => {
  const { con } = ctx
  const newestRaw = (await con.one('SELECT max(day) AS d FROM v_odometer_daily')).d
  const newest = newestRaw === null || newestRaw === undefined ? null : dayOf(newestRaw)
  const base = {
    enough: false, as_of: newest, window_days: WINDOW_DAYS, month_days: MONTH_DAYS, block_days: BLOCK_DAYS,
    replicates: REPLICATES, min_days: MIN_DAYS, days_with_data: 0, months_of_data: 0.0,
    km_low: null as number | null, km_mid: null as number | null, km_high: null as number | null,
    l_per_100km: null as number | null, consumption_from: null as string | null,
    litres_low: null as number | null, litres_mid: null as number | null, litres_high: null as number | null,
    price_per_l: null as number | null, currency: null as string | null,
    cost_low: null as number | null, cost_mid: null as number | null, cost_high: null as number | null,
  }
  if (newest === null) return base
  const first = dayOf((await con.one('SELECT min(day) AS d FROM v_odometer_daily')).d)
  const found = new Map<string, number>()
  for (const row of await con.rows(DAILY_SQL, [newest, newest])) found.set(dayOf(row.day), Number(row.km))
  const days = Array.from({ length: WINDOW_DAYS }, (_, i) => shift(newest, -(WINDOW_DAYS - 1 - i)))
  const daily = days.map((d) => found.get(d) || 0.0)
  base.days_with_data = found.size
  base.months_of_data = pyRound(daysBetween(first, newest) / 30.4, 1)
  if (found.size < MIN_DAYS) return base
  const sums = bootstrap(daily)
  const km = [0.1, 0.5, 0.9].map((q) => percentile(sums, q))
  let since = days[0]
  const segments = ((await changePoints(ctx)) as { segments: { from_at: string }[] }).segments
  if (segments.length > 1 && dayOf(segments[segments.length - 1].from_at) > since) since = dayOf(segments[segments.length - 1].from_at)
  const fuel = await con.one(FUEL_SQL, [since, newest])
  const rate = fuel.km && fuel.fuel_l !== null && fuel.fuel_l !== undefined ? (100 * Number(fuel.fuel_l)) / Number(fuel.km) : null
  const litres = km.map((k) => (rate !== null ? (k * rate) / 100 : null))
  const perL = (await con.one(PRICE_SQL, [newest])).per_l
  const price = perL === null || perL === undefined ? null : Number(perL)
  const currency = (await con.one("SELECT max(value) FILTER (WHERE key = 'fuel_currency') AS c FROM ref_settings")).c
  const cost = litres.map((v) => (v !== null && price !== null ? v * price : null))
  return {
    ...base,
    enough: true,
    km_low: pyRound(km[0], 0),
    km_mid: pyRound(km[1], 0),
    km_high: pyRound(km[2], 0),
    l_per_100km: r(rate, 2),
    consumption_from: since,
    litres_low: r(litres[0], 0),
    litres_mid: r(litres[1], 0),
    litres_high: r(litres[2], 0),
    price_per_l: price,
    currency: price !== null ? ((currency as string | null) ?? null) : null,
    cost_low: r(cost[0], 0),
    cost_mid: r(cost[1], 0),
    cost_high: r(cost[2], 0),
  }
}
