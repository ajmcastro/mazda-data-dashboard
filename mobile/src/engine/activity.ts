/** When the car is used (port of `activity_pattern` in `api/app.py`, PLAN.md M35). */
import type { Handler } from './context'
import { pick } from './http'
import { ACTIVITY_HOUR, ACTIVITY_WEEKDAY } from './shapes'

export const activityPattern: Handler = async ({ con, range }) => {
  const { sql, params } = range().clause('at_utc')
  const zone =
    (await con.one("SELECT coalesce(max(value) FILTER (WHERE key = 'car_timezone'), 'UTC') AS zone FROM ref_settings")).zone ?? 'UTC'
  const hours = await con.rows(
    `WITH ev AS (SELECT * FROM v_activity_events ${sql})
     SELECT h.hr AS hour,
            count(DISTINCT CAST(ev.local_at AS DATE)) AS active_days,
            count(DISTINCT ev.code) AS warning_codes,
            round(coalesce(sum(ev.km), 0), 1) AS km,
            count(*) FILTER (WHERE ev.kind = 'drive') AS drives
     FROM range(24) h(hr) LEFT JOIN ev ON hour(ev.local_at) = h.hr
     WHERE (SELECT count(*) FROM ev) > 0
     GROUP BY h.hr ORDER BY h.hr`,
    params,
  )
  const weekdays = await con.rows(
    `WITH ev AS (SELECT * FROM v_activity_events ${sql}),
          span AS (SELECT CAST(min(local_at) AS DATE) AS a, CAST(max(local_at) AS DATE) AS b FROM ev),
          cal AS (SELECT isodow(g.d) - 1 AS wd, count(*) AS calendar_days
                  FROM span, generate_series(span.a, span.b, INTERVAL 1 DAY) g(d) GROUP BY 1),
          day AS (SELECT CAST(local_at AS DATE) AS d, sum(km) AS km,
                         count(*) FILTER (WHERE kind = 'warning') AS warns
                  FROM ev GROUP BY 1)
     SELECT w.wd AS weekday, coalesce(max(cal.calendar_days), 0) AS calendar_days,
            count(day.d) AS active_days,
            count(*) FILTER (WHERE day.warns > 0) AS warning_days,
            round(coalesce(sum(day.km), 0), 1) AS km
     FROM range(7) w(wd) LEFT JOIN cal ON cal.wd = w.wd
          LEFT JOIN day ON isodow(day.d) - 1 = w.wd
     WHERE (SELECT count(*) FROM ev) > 0
     GROUP BY w.wd ORDER BY w.wd`,
    params,
  )
  return {
    time_zone: zone,
    hours: hours.map((r) => pick(r, ACTIVITY_HOUR)),
    weekdays: weekdays.map((r) => pick(r, ACTIVITY_WEEKDAY)),
  }
}
