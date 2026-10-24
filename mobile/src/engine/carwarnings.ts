/** The car's own warning flags (port of `car_warnings` in `api/app.py`). A state: ignores the period. */
import type { Handler } from './context'
import { pick } from './http'
import { CAR_WARNING_EPISODE, CAR_WARNING_FLAG } from './shapes'

export const carWarnings: Handler = async ({ con }) => {
  const flags = await con.rows(
    `WITH latest AS (
               SELECT flag, label, sort_order, read_at, value, is_on,
                      row_number() OVER (PARTITION BY flag ORDER BY read_at DESC) AS rk
               FROM v_car_warning_readings),
           counts AS (SELECT flag, count(*) AS readings FROM v_car_warning_readings GROUP BY flag)
           SELECT l.flag, l.label, l.is_on, l.value, l.read_at AS last_read_at, c.readings,
                  (SELECT count(*) FROM v_car_warning_episodes e WHERE e.flag = l.flag) AS episodes,
                  (SELECT min(started_at) FROM v_car_warning_episodes e
                   WHERE e.flag = l.flag AND e.ongoing) AS since
           FROM latest l JOIN counts c USING (flag) WHERE l.rk = 1 ORDER BY l.sort_order`,
  )
  const episodes = await con.rows(
    'SELECT flag, label, started_at, last_on_at, readings, max_value, ongoing ' +
      'FROM v_car_warning_episodes ORDER BY started_at DESC, sort_order, flag',
  )
  return {
    has_data: flags.length > 0,
    all_clear: !flags.some((f) => f.is_on),
    flags: flags.map((f) => pick(f, CAR_WARNING_FLAG)),
    episodes: episodes.map((e) => pick(e, CAR_WARNING_EPISODE)),
  }
}
