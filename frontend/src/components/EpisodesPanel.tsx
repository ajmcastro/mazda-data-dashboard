// The warnings as recurring patterns (PLAN.md M63): which codes usually turn up together. Wording in
// `episodes.ts`; hints only, never the meaning of a code.
import { tr } from '../i18n'
import type { WarningEpisodes, WarningPattern } from '../api/types'
import { EPISODES_NOTE, commonLine, faultLine, oneOffLine, patternCodes, patternLine, recurring, summaryLine } from '../episodes'
import { fmtDate, fmtNum } from '../lib'
import { Panel } from './ui'

function Codes({ p, onCode }: { p: WarningPattern; onCode?: (code: string) => void }) {
  const { core, sometimes, rarer } = patternCodes(p)
  if (!core.length && !sometimes.length) return <span className="muted">{tr('only codes that are in nearly every episode')}</span>
  return (
    <div className="chips">
      {core.map((c) => (
        <button key={c.code} type="button" className="chip mono on" title={c.title ?? undefined} onClick={onCode && (() => onCode(c.code))}>
          {c.code} <span className="muted">{tr('always')}</span>
        </button>
      ))}
      {sometimes.map((c) => (
        <button key={c.code} type="button" className="chip mono" title={c.title ?? undefined} onClick={onCode && (() => onCode(c.code))}>
          {c.code} <span className="muted">{tr('sometimes')} · {fmtNum(c.pct, 0)}%</span>
        </button>
      ))}
      {rarer > 0 && <span className="chip muted">{tr('+{n} rarer', { n: rarer })}</span>}
    </div>
  )
}

export default function EpisodesPanel({ data, onCode }: { data: WarningEpisodes | undefined; onCode?: (code: string) => void }) {
  const pats = recurring(data)
  const summary = summaryLine(data)
  const common = commonLine(data)
  const oneOff = oneOffLine(data)
  return (
    <Panel title={tr('Patterns')} hint={tr('which warning codes usually turn up together')}>
      {!summary ? (
        <p className="muted">{tr('No warnings in this period.')}</p>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>{summary}</p>
          <ol className="episode-list">
            {pats.map((p) => (
              <li key={p.pattern}>
                <div className="episode-head">
                  <strong>{tr('Pattern {n}', { n: p.pattern })}</strong>
                  <span className="muted">{patternLine(p)}</span>
                  <span className="muted mono">{fmtDate(p.last_at)}</span>
                </div>
                <Codes p={p} onCode={onCode} />
                {p.faults.length > 0 && (
                  <div className="episode-faults muted">
                    {tr('Faults read out nearby')}:{' '}
                    {p.faults.map((f, i) => (
                      <span key={`${f.ecu}-${f.dtc_code}`}>
                        {i > 0 && '; '}
                        <span className="mono">{f.ecu} {f.dtc_code}</span> {faultLine(f, p.episodes, data!.fault_hours)}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
          {common && <p className="muted">{common}</p>}
          {oneOff && <p className="muted">{oneOff}</p>}
        </>
      )}
      <p className="muted note">{tr(EPISODES_NOTE, { gap: data?.gap_minutes ?? 10 })}</p>
    </Panel>
  )
}
