/** Who rides, from the seat belts (port of `occupancy` in `api/app.py`, PLAN.md M37). */
import type { Handler } from './context'
import { pick } from './http'
import { OCCUPANCY_MONTH, SEAT_SENSOR } from './shapes'

const COUNTS = `
    count(*) AS readings,
    count(*) FILTER (WHERE driver_belt = 1) AS belted_readings,
    count(*) FILTER (WHERE driver_belt = 1 AND passenger_belt = 1) AS passenger_readings,
    count(*) FILTER (WHERE driver_belt = 1 AND (rear_left_belt = 1 OR rear_right_belt = 1)) AS rear_readings,
    count(*) FILTER (WHERE driver_belt = 1 AND rear_left_belt = 1) AS rear_left_readings,
    count(*) FILTER (WHERE driver_belt = 1 AND rear_right_belt = 1) AS rear_right_readings,
    count(*) FILTER (WHERE driver_belt = 1 AND coalesce(passenger_belt, 0) = 0
                     AND coalesce(rear_left_belt, 0) = 0 AND coalesce(rear_right_belt, 0) = 0)
        AS driver_only_readings`

// the seat sensors (M72) among the same readings, documented values only: the SQL of `SEAT_SENSORS` in app.py
const SEAT_SENSORS = (where: string) =>
  "SELECT seat, count(*) FILTER (WHERE state <> 'unknown') AS readings, " +
  "count(*) FILTER (WHERE label = 'Occupied') AS occupied_readings, " +
  'arg_max(value, created_at) AS latest_value, arg_max(label, created_at) AS latest_label, ' +
  'arg_max(state, created_at) AS latest_state, max(created_at) AS latest_at ' +
  `FROM v_seat_sensors WHERE TRUE ${where} GROUP BY seat ` +
  "ORDER BY CASE seat WHEN 'passenger' THEN 1 WHEN 'rear_left' THEN 2 WHEN 'rear_center' THEN 3 ELSE 4 END"

export const occupancy: Handler = async ({ con, range }) => {
  const { sql, params } = range().clause('created_at', 'AND')
  const base = `FROM v_occupancy WHERE driver_belt IS NOT NULL ${sql}`
  const total = await con.one(`SELECT ${COUNTS} ${base}`, params)
  const months = await con.rows(
    "SELECT strftime(date_trunc('month', created_at), '%Y-%m') AS month, " +
      'count(*) FILTER (WHERE driver_belt = 1) AS belted_readings, ' +
      'count(*) FILTER (WHERE driver_belt = 1 AND passenger_belt = 1) AS passenger_readings, ' +
      'count(*) FILTER (WHERE driver_belt = 1 AND (rear_left_belt = 1 OR rear_right_belt = 1)) AS rear_readings ' +
      `${base} GROUP BY 1 HAVING count(*) FILTER (WHERE driver_belt = 1) > 0 ORDER BY 1`,
    params,
  )
  const sensors = await con.rows(SEAT_SENSORS(sql), params)
  return {
    available: (total.readings as number) > 0,
    readings: total.readings,
    belted_readings: total.belted_readings,
    passenger_readings: total.passenger_readings,
    rear_readings: total.rear_readings,
    rear_left_readings: total.rear_left_readings,
    rear_right_readings: total.rear_right_readings,
    driver_only_readings: total.driver_only_readings,
    months: months.map((r) => pick(r, OCCUPANCY_MONTH)),
    sensors: sensors.map((r) => pick(r, SEAT_SENSOR)),
  }
}
