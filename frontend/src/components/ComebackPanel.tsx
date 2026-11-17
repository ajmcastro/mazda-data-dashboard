// Whether a fault comes back after it stops being listed (PLAN.md M67). Wording in `comeback.ts`: the read-outs,
// never a cause or a verdict on a repair.
import { tr } from '../i18n'
import { useComeback, useServiceLog } from '../api/hooks'
import type { DtcFrequency } from '../api/types'
import { COMEBACK_NOTE, comebackOf, estimateLine, historyLine, nowLine, serviceBefore, waitsLine } from '../comeback'
import { fmtDate } from '../lib'
import { Panel, QueryState } from './ui'

export function ComebackPanel({ fault }: { fault: DtcFrequency }) {
  const query = useComeback()
  const service = useServiceLog()
  const f = comebackOf(query.data, fault.ecu, fault.dtc_code)
  return (
    <Panel title={tr('Comes back?')} hint={tr('when it stopped being listed, and when it was listed again')}>
      <QueryState query={query}>
        {!f ? (
          <p className="muted">{tr('Its unit has no read-out that answered.')}</p>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>{historyLine(f)} {nowLine(f)}</p>
            <p>{waitsLine(f)}</p>
            {f.waits.some((w) => serviceBefore(w.from_at, service.data?.entries)) && (
              <ul className="steps-list">
                {f.waits.map((w) => {
                  const near = serviceBefore(w.from_at, service.data?.entries)
                  return near ? (
                    <li key={w.from_at} className="muted">
                      {tr('Stopped being listed by {date}, {near}.', { date: fmtDate(w.from_at), near })}
                    </li>
                  ) : null
                })}
              </ul>
            )}
            <p className={f.enough ? '' : 'muted'}>{estimateLine(f, query.data!.min_ended)}</p>
          </>
        )}
        <p className="muted note">{tr(COMEBACK_NOTE)}</p>
      </QueryState>
    </Panel>
  )
}
