/**
 * Alerts. The pack carries the alerts the Mac had raised. Acknowledging on the phone changes the
 * in-browser table and is also written to an `AckStore`, so it survives a restart (the table is
 * rebuilt from the pack each time) and a newer pack (acks are kept by the alert's `dedup_key`).
 */
import type { Handler } from './context'
import type { Con } from './db'
import { HttpError, pick } from './http'
import { ALERT } from './shapes'

export interface AckStore {
  /** dedup_key -> `YYYY-MM-DD HH:MM:SS.mmm` (UTC) of every acknowledgement made on this phone. */
  load(): Promise<Record<string, string>>
  save(dedupKey: string, at: string): Promise<void>
}

export class MemoryAckStore implements AckStore {
  private acks: Record<string, string> = {}
  async load() {
    return { ...this.acks }
  }
  async save(dedupKey: string, at: string) {
    this.acks[dedupKey] = at
  }
}

const COLS = ALERT.join(', ')

export function stamp(d: Date): string {
  return d.toISOString().replace('T', ' ').replace('Z', '')
}

/** Applies the acknowledgements made on this phone to a freshly loaded pack. */
export async function replayAcks(con: Con, store: AckStore): Promise<number> {
  if (!(await con.hasTable('alerts'))) return 0
  let n = 0
  for (const [key, at] of Object.entries(await store.load())) {
    n += (
      await con.rows(
        "UPDATE alerts SET status = 'acknowledged', acknowledged_at = CAST(? AS TIMESTAMP) " +
          "WHERE dedup_key = ? AND status = 'new' RETURNING alert_id",
        [at, key],
      )
    ).length
  }
  return n
}

export function alertHandlers(store: AckStore, now: () => Date) {
  const remember = async (rows: Record<string, unknown>[], at: string) => {
    for (const r of rows) if (r.dedup_key) await store.save(String(r.dedup_key), at)
  }

  const list: Handler = async ({ con, q }) => {
    const status = q.oneOf('status', ['new', 'acknowledged', 'all'], 'new')
    if (!(await con.hasTable('alerts'))) return []
    const where = status === 'all' ? '' : 'WHERE status = ?'
    return (
      await con.rows(
        `SELECT ${COLS} FROM alerts ${where} ` +
          "ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, " +
          'occurred_at DESC NULLS LAST, alert_id DESC',
        status === 'all' ? [] : [status],
      )
    ).map((r) => pick(r, ALERT))
  }

  const acknowledgeAll: Handler = async ({ con }) => {
    if (!(await con.hasTable('alerts'))) return { acknowledged: 0 }
    const at = stamp(now())
    const changed = await con.rows(
      "UPDATE alerts SET status = 'acknowledged', acknowledged_at = CAST(? AS TIMESTAMP) " +
        "WHERE status = 'new' RETURNING dedup_key",
      [at],
    )
    await remember(changed, at)
    return { acknowledged: changed.length }
  }

  const acknowledge: Handler = async ({ con, path }) => {
    if (!/^[+-]?\d+$/.test(path.alert_id)) {
      throw new HttpError(422, [{ type: 'int_parsing', loc: ['path', 'alert_id'], msg: 'Input should be a valid integer' }])
    }
    const id = Number(path.alert_id)
    if (await con.hasTable('alerts')) {
      const at = stamp(now())
      const changed = await con.rows(
        "UPDATE alerts SET status = 'acknowledged', acknowledged_at = CAST(? AS TIMESTAMP) " +
          "WHERE alert_id = ? AND status = 'new' RETURNING dedup_key",
        [at, id],
      )
      await remember(changed, at)
    }
    const found = (await con.hasTable('alerts'))
      ? await con.rows(`SELECT ${COLS} FROM alerts WHERE alert_id = ?`, [id])
      : []
    if (!found.length) throw new HttpError(404, `No alert with id ${id}`)
    return pick(found[0], ALERT)
  }

  return { list, acknowledgeAll, acknowledge }
}
