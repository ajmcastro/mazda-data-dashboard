/**
 * What the values of some signals mean, as Mazda documents them for the model's platform (port of
 * `signal_values` in `api/app.py`, PLAN.md M72). The pack carries `ref_signal_values`; an older pack has an
 * empty one (made when it is loaded), so the answer is then empty and the pages show raw numbers.
 */
import type { Handler } from './context'
import { pick } from './http'
import { SIGNAL_VALUE } from './shapes'

export const signalValues: Handler = async ({ con }) => {
  const cfg = await con.one(
    "SELECT max(value) FILTER (WHERE key = 'platform') AS platform, " +
      "max(value) FILTER (WHERE key = 'signal_values_source') AS source FROM ref_settings",
  )
  const values = await con.rows('SELECT signal, value, label, state FROM ref_signal_values ORDER BY signal, value')
  return { platform: cfg.platform ?? null, source: cfg.source ?? null, values: values.map((r) => pick(r, SIGNAL_VALUE)) }
}
