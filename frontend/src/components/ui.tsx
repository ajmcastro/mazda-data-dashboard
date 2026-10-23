import { useMemo, useState, type ReactNode } from 'react'

export function Panel({ title, hint, children, className = '' }: {
  title?: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-head">
          <h2>{title}</h2>
          {hint && <span className="hint">{hint}</span>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Stat({ label, value, unit, sub, alert }: {
  label: string
  value: ReactNode
  unit?: string
  sub?: ReactNode
  alert?: boolean
}) {
  return (
    <div className={`panel stat ${alert ? 'alert' : ''}`}>
      <div className="label">{label}</div>
      <div className="value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

export function Badge({ kind, children }: { kind: string; children: ReactNode }) {
  return <span className={`badge ${kind}`}>{children}</span>
}

/** Shows the API's own message for errors; a 503 means the database has not been built yet. */
export function QueryState({ query, children }: {
  query: { isPending: boolean; isError: boolean; error: Error | null }
  children: ReactNode
}) {
  if (query.isPending) return <div className="skeleton" aria-busy="true" />
  if (query.isError) {
    return (
      <div className="state error" role="alert">
        {query.error?.message ?? 'Request failed'}
        <div className="muted" style={{ marginTop: 6 }}>
          Is the API running? Try <code>make dev</code>, and <code>make ingest</code> if the database is missing.
        </div>
      </div>
    )
  }
  return <>{children}</>
}

export type Column<T> = {
  key: string
  header: string
  render: (row: T) => ReactNode
  sort?: (row: T) => number | string
  num?: boolean
}

export function DataTable<T>({ rows, columns, rowKey, selected, onSelect, empty = 'Nothing to show' }: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  selected?: string
  onSelect?: (row: T) => void
  empty?: string
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort?.key)
    if (!sort || !col?.sort) return rows
    const get = col.sort
    return [...rows].sort((a, b) => {
      const x = get(a)
      const y = get(b)
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
    })
  }, [rows, columns, sort])

  if (rows.length === 0) return <div className="state">{empty}</div>
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`${c.sort ? 'sortable' : ''} ${c.num ? 'num' : ''}`}
                onClick={() => c.sort && setSort({ key: c.key, dir: sort?.key === c.key ? (-sort.dir as 1 | -1) : -1 })}
                aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
              >
                {c.header}
                {sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const id = rowKey(r)
            return (
              <tr
                key={id}
                className={`${onSelect ? 'clickable' : ''} ${selected === id ? 'selected' : ''}`}
                onClick={() => onSelect?.(r)}
              >
                {columns.map((c) => (
                  <td key={c.key} className={c.num ? 'num mono' : ''}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function ChartTip({ active, payload, label, fmtLabel }: {
  active?: boolean
  payload?: { name?: string; value?: number | string; color?: string }[]
  label?: number | string
  fmtLabel: (v: number | string) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tip">
      <div className="t">{label !== undefined ? fmtLabel(label) : ''}</div>
      {payload.map((p) => (
        <div className="row" key={String(p.name)}>
          <span style={{ color: p.color }}>{p.name}</span>
          <span>{typeof p.value === 'number' ? Math.round(p.value * 100) / 100 : p.value}</span>
        </div>
      ))}
    </div>
  )
}
