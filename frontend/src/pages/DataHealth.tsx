import { t, tr } from '../i18n'
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
      key: 'kind', header: tr('Export'), sort: (k) => kindLabel(k.kind),
      render: (k) => <>{kindLabel(k.kind)} <span className="muted mono">{KINDS[k.kind]?.file}</span></>,
    },
    { key: 'first', header: tr('First'), sort: (k) => k.first_at ?? '', render: (k) => fmtDate(k.first_at) },
    { key: 'last', header: tr('Last'), sort: (k) => k.last_at ?? '', render: (k) => fmtDate(k.last_at) },
    { key: 'n', header: tr('Records'), num: true, sort: (k) => k.records, render: (k) => fmtNum(k.records) },
    { key: 'days', header: tr('Days'), num: true, sort: (k) => k.days, render: (k) => fmtNum(k.days) },
    {
      key: 'bar', header: tr('In the period'),
      render: (k) => {
        const bar = h ? coverageBar(k, h) : null
        return (
          <div className="cover-track" role="img" aria-label={bar ? tr('from {from} to {to}', { from: fmtDate(k.first_at), to: fmtDate(k.last_at) }) : tr('nothing in this period')}>
            {bar && <i style={{ left: `${bar.left}%`, width: `${bar.width}%` }} />}
          </div>
        )
      },
    },
  ]
  const gapCols: Column<DataGap>[] = [
    { key: 'from', header: tr('Last report before'), sort: (g) => g.from_at, render: (g) => fmtDateTime(g.from_at) },
    { key: 'to', header: tr('Next report'), sort: (g) => g.to_at, render: (g) => fmtDateTime(g.to_at) },
    { key: 'len', header: tr('Silence'), num: true, sort: (g) => g.hours, render: (g) => gapLength(g.hours) },
    { key: 'h', header: tr('Hours'), num: true, sort: (g) => g.hours, render: (g) => fmtNum(g.hours, 1) },
  ]
  const invalidCols: Column<InvalidSignal>[] = [
    { key: 'sig', header: tr('Signal'), sort: (s) => s.signal, render: (s) => <span className="mono">{s.signal}</span> },
    { key: 'src', header: tr('From'), sort: (s) => s.source, render: (s) => kindLabel(s.source) },
    { key: 'inv', header: tr('Invalid'), num: true, sort: (s) => s.invalid, render: (s) => fmtNum(s.invalid) },
    { key: 'n', header: tr('Readings'), num: true, sort: (s) => s.readings, render: (s) => fmtNum(s.readings) },
    { key: 'pct', header: tr('Share'), num: true, sort: (s) => s.pct, render: (s) => `${fmtNum(s.pct, 1)}%` },
  ]
  const covered = h ? share(h.days_with_status, h.days_in_range) : null
  const invalidPct = h ? share(h.invalid_readings, h.readings_checked) : null

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('page.health')}</h1>
          <p>{tr('What the exports cover, where the status reports fall silent and what the car flagged as Invalid.')}</p>
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
                    label={tr('Days with a status report')}
                    value={fmtNum(h.days_with_status)}
                    unit={tr('of {n}', { n: fmtNum(h.days_in_range) })}
                    sub={covered === null ? undefined : tr('{pct}% of the days from {from} to {to}', { pct: fmtNum(covered, 1), from: fmtDate(h.range_from), to: fmtDate(h.range_to) })}
                  />
                  <Stat label={tr('Status reports')} value={fmtNum(h.snapshots)} sub={h.median_gap_hours != null ? tr('usually {gap} apart', { gap: gapLength(h.median_gap_hours) }) : undefined} />
                  <Stat
                    label={tr('Longest silence')}
                    value={h.longest_gap_hours != null ? fmtNum(h.longest_gap_hours < 48 ? h.longest_gap_hours : h.longest_gap_hours / 24, 1) : '—'}
                    unit={h.longest_gap_hours != null ? (h.longest_gap_hours < 48 ? tr('h') : tr('days')) : undefined}
                    sub={tr('{n} of {hours} hours or more', { n: fmtNum(h.gaps_total), hours: fmtNum(h.gap_threshold_hours) })}
                  />
                  <Stat
                    label={tr('Invalid readings')}
                    value={invalidPct === null ? '—' : invalidPct < 0.1 && h.invalid_readings > 0 ? '<0.1' : fmtNum(invalidPct, 1)}
                    unit="%"
                    sub={tr('{n} of {total} readings', { n: fmtNum(h.invalid_readings), total: fmtNum(h.readings_checked) })}
                  />
                </div>

                <Panel title={tr('What each export covers')} hint={`${fmtDate(h.range_from)} – ${fmtDate(h.range_to)}`} className="mt">
                  <DataTable rows={h.kinds} columns={kindCols} rowKey={(k) => k.kind} />
                  <p className="muted note">
                    {tr("An export is one kind of file in Mazda's download, recognised by the part of its name shown. For the three kinds of report a record is one report, whatever the number of signals in it.")}
                  </p>
                </Panel>

                <Panel title={tr('Silences between status reports')} hint={tr('{n} hours or more', { n: fmtNum(h.gap_threshold_hours) })} className="mt">
                  {h.gaps.length > 0 && <DataTable rows={h.gaps} columns={gapCols} rowKey={(g) => g.from_at} />}
                  {gapsNote(h) && <p className="muted note">{gapsNote(h)}</p>}
                  <p className="muted note">{tr(HEALTH_NOTE)}</p>
                </Panel>

                <Panel title={tr('Signals the car flagged Invalid')} hint={tr('of the signals the dashboard reads')} className="mt">
                  <p style={{ margin: '0 0 10px' }}>{invalidLine(h)}</p>
                  {h.invalid.length > 0 && <DataTable rows={h.invalid} columns={invalidCols} rowKey={(s) => `${s.source}/${s.signal}`} />}
                  <p className="muted note">
                    {tr("The names are the car's own. Of the status reports only the signals a page reads are counted; the door and alarm reports are counted whole.")}
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
