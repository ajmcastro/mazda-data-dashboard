import type { Handler } from './context'
import { pick } from './http'
import { UNMAPPED_CODE, WARNING_DAY, WARNING_EVENT, WARNING_FREQUENCY } from './shapes'

const shaped = (rows: Record<string, unknown>[], fields: readonly string[]) => rows.map((r) => pick(r, fields))

export const warningFrequency: Handler = async ({ con, range }) => {
  // same aggregates as v_warning_frequency; the share is relative to the events in range
  const { sql, params } = range().clause('triggered_at')
  return shaped(
    await con.rows(
      'SELECT code, any_value(title) AS title, any_value(severity) AS severity, ' +
        'bool_or(known) AS known, count(*) AS events, ' +
        `round(100.0 * count(*) / (SELECT count(*) FROM warning_events ${sql}), 1) AS pct_of_events, ` +
        'count(DISTINCT CAST(triggered_at AS DATE)) AS days_seen, ' +
        'min(triggered_at) AS first_seen, max(triggered_at) AS last_seen ' +
        `FROM v_warnings ${sql} GROUP BY code ORDER BY events DESC, code`,
      [...params, ...params],
    ),
    WARNING_FREQUENCY,
  )
}

export const warningDaily: Handler = async ({ con, range }) => {
  const { sql, params } = range().clause('triggered_at', 'AND')
  return shaped(
    await con.rows(
      'SELECT CAST(triggered_at AS DATE) AS day, code, count(*) AS events FROM v_warnings ' +
        `WHERE triggered_at IS NOT NULL ${sql} GROUP BY 1, 2 ORDER BY 1, 2`,
      params,
    ),
    WARNING_DAY,
  )
}

export const warningEvents: Handler = async ({ con, q, range }) => {
  const code = q.str('code')
  const limit = q.int('limit', 100, 1, 1000)
  const offset = q.int('offset', 0, 0)
  const { conds, params } = range().conds('triggered_at')
  if (code) {
    conds.push('code = ?')
    params.push(code)
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const total = (await con.one(`SELECT count(*) AS n FROM v_warnings ${where}`, params)).n
  const items = await con.rows(
    'SELECT transaction_id, triggered_at, odometer_km, code, title, severity, known ' +
      `FROM v_warnings ${where} ORDER BY triggered_at DESC NULLS LAST LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )
  return { total, items: shaped(items, WARNING_EVENT) }
}

export const unmapped: Handler = async ({ con }) =>
  shaped(await con.rows('SELECT * FROM v_unmapped_codes ORDER BY kind, occurrences DESC, code'), UNMAPPED_CODE)
