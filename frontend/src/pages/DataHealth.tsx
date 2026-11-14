import { useDataHealth } from '../api/hooks'
import type { DataGap, DataKind, InvalidSignal } from '../api/types'
import { DataTable, Panel, QueryState, Stat, type Column } from '../components/ui'
import { HEALTH_NOTE, KINDS, coverageBar, coverageLine, gapLength, gapsNote, invalidLine, kindLabel, share, usualLine } from '../health'
import { fmtDate, fmtDateTime, fmtNum } from '../lib'

/** What each export covers, where the status reports fall silent and what the car flagged Invalid (PLAN.md M46). */
export default function DataHealthPage() {
  const query = useDataHealth()
  const h = query.data

  const kindCols: Column<DataKind>[] = [
    {
      key: 'kind', header: 'Export', sort: (k) => kindLabel(k.kind),
      render: (k) => <>{kindLabel(k.kind)} <span className="muted mono">{KINDS[k.kind]?.file}</span></>,
    },
    { key: 'first', header: 'First', sort: (k) => k.first_at ?? '', render: (k) => fmtDate(k.first_at) },
    { key: 'last', header: 'Last', sort: (k) => k.last_at ?? '', render: (k) => fmtDate(k.last_at) },
    { key: 'n', header: 'Records', num: true, sort: (k) => k.records, render: (k) => fmtNum(k.records) },
    { key: 'days', header: 'Days', num: true, sort: (k) => k.days, render: (k) => fmtNum(k.days) },
    {
      key: 'bar', header: 'In the period',
      render: (k) => {
        const bar = h ? coverageBar(k, h) : null
        return (
          <div className="cover-track" role="img" aria-label={bar ? `from ${fmtDate(k.first_at)} to ${fmtDate(k.last_at)}` : 'nothing in this period'}>
            {bar && <i style={{ left: `${bar.left}%`, width: `${bar.width}%` }} />}
          </div>
        )
      },
    },
  ]
  const gapCols: Column<DataGap>[] = [
    { key: 'from', header: 'Last report before', sort: (g) => g.from_at, render: (g) => fmtDateTime(g.from_at) },
    { key: 'to', header: 'Next report', sort: (g) => g.to_at, render: (g) => fmtDateTime(g.to_at) },
    { key: 'len', header: 'Silence', num: true, sort: (g) => g.hours, render: (g) => gapLength(g.hours) },
    { key: 'h', header: 'Hours', num: true, sort: (g) => g.hours, render: (g) => fmtNum(g.hours, 1) },
  ]
  const invalidCols: Column<InvalidSignal>[] = [
    { key: 'sig', header: 'Signal', sort: (s) => s.signal, render: (s) => <span className="mono">{s.signal}</span> },
    { key: 'src', header: 'From', sort: (s) => s.source, render: (s) => kindLabel(s.source) },
    { key: 'inv', header: 'Invalid', num: true, sort: (s) => s.invalid, render: (s) => fmtNum(s.invalid) },
    { key: 'n', header: 'Readings', num: true, sort: (s) => s.readings, render: (s) => fmtNum(s.readings) },
    { key: 'pct', header: 'Share', num: true, sort: (s) => s.pct, render: (s) => `${fmtNum(s.pct, 1)}%` },
  ]
  const covered = h ? share(h.days_with_status, h.days_in_range) : null
  const invalidPct = h ? share(h.invalid_readings, h.readings_checked) : null

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Data health</h1>
          <p>What the exports cover, where the status reports fall silent and what the car flagged as Invalid.</p>
        </div>
      </div>

      <QueryState query={query}>
        {h && (
          <>
            <Panel>
              <p style={{ margin: 0 }}>{coverageLine(h)}</p>
              {usualLine(h) && <p className="muted" style={{ margin: '8px 0 0' }}>{usualLine(h)}</p>}
            </Panel>

            {h.has_data && (
              <>
                <div className="grid cols-4" style={{ marginTop: 14 }}>
                  <Stat
                    label="Days with a status report"
                    value={fmtNum(h.days_with_status)}
                    unit={`of ${fmtNum(h.days_in_range)}`}
                    sub={covered === null ? undefined : `${fmtNum(covered, 1)}% of the days from ${fmtDate(h.range_from)} to ${fmtDate(h.range_to)}`}
                  />
                  <Stat label="Status reports" value={fmtNum(h.snapshots)} sub={h.median_gap_hours != null ? `usually ${gapLength(h.median_gap_hours)} apart` : undefined} />
                  <Stat
                    label="Longest silence"
                    value={h.longest_gap_hours != null ? gapLength(h.longest_gap_hours).replace(/ (h|days)$/, '') : '—'}
                    unit={h.longest_gap_hours != null ? (h.longest_gap_hours < 48 ? 'h' : 'days') : undefined}
                    sub={`${fmtNum(h.gaps_total)} of ${fmtNum(h.gap_threshold_hours)} hours or more`}
                  />
                  <Stat
                    label="Invalid readings"
                    value={invalidPct === null ? '—' : invalidPct < 0.1 && h.invalid_readings > 0 ? '<0.1' : fmtNum(invalidPct, 1)}
                    unit="%"
                    sub={`${fmtNum(h.invalid_readings)} of ${fmtNum(h.readings_checked)} readings`}
                  />
                </div>

                <Panel title="What each export covers" hint={`${fmtDate(h.range_from)} – ${fmtDate(h.range_to)}`} className="mt">
                  <DataTable rows={h.kinds} columns={kindCols} rowKey={(k) => k.kind} />
                  <p className="muted note">
                    An export is one kind of file in Mazda's download, recognised by the part of its name shown. For the
                    three kinds of report a record is one report, whatever the number of signals in it.
                  </p>
                </Panel>

                <Panel title="Silences between status reports" hint={`${fmtNum(h.gap_threshold_hours)} hours or more`} className="mt">
                  {h.gaps.length > 0 && <DataTable rows={h.gaps} columns={gapCols} rowKey={(g) => g.from_at} />}
                  {gapsNote(h) && <p className="muted note">{gapsNote(h)}</p>}
                  <p className="muted note">{HEALTH_NOTE}</p>
                </Panel>

                <Panel title="Signals the car flagged Invalid" hint="of the signals the dashboard reads" className="mt">
                  <p style={{ margin: '0 0 10px' }}>{invalidLine(h)}</p>
                  {h.invalid.length > 0 && <DataTable rows={h.invalid} columns={invalidCols} rowKey={(s) => `${s.source}/${s.signal}`} />}
                  <p className="muted note">
                    The names are the car's own. Of the status reports only the signals a page reads are counted; the
                    door and alarm reports are counted whole.
                  </p>
                </Panel>
              </>
            )}
          </>
        )}
      </QueryState>
    </>
  )
}
