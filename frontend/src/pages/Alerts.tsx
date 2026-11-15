import { t } from '../i18n'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { alertPart, partName } from '../car'
import { useAcknowledge, useAcknowledgeAll, useAlerts } from '../api/hooks'
import type { Alert } from '../api/types'
import { RangeLink } from '../components/RangeLink'
import { Badge, Panel, QueryState } from '../components/ui'
import { fmtDateTime } from '../lib'
import { DEFAULT_UNITS, unitsKey } from '../units'
import { useCurrentModel } from '../model'

const KIND: Record<string, string> = { critical: 'critical', warning: 'warning', info: 'info' }

function AlertCard({ alert, onAck, busy }: { alert: Alert; onAck?: () => void; busy: boolean }) {
  return (
    <article className={`alert-card ${alert.severity}`}>
      <div className="alert-main">
        <div className="alert-title">
          <Badge kind={KIND[alert.severity] ?? 'dim'}>{alert.severity}</Badge>
          <b>{alert.title}</b>
        </div>
        {alert.detail && <p>{alert.detail}</p>}
        <div className="alert-meta mono">
          {fmtDateTime(alert.occurred_at)} · {alert.rule.replaceAll('_', ' ')}
          {alert.acknowledged_at && ` · acknowledged ${fmtDateTime(alert.acknowledged_at)}`}
        </div>
      </div>
      <div className="alert-actions">
        {alert.link && alert.link !== '/alerts' && <RangeLink to={alert.link}>View →</RangeLink>}
        {onAck && (
          <button onClick={onAck} disabled={busy}>
            Acknowledge
          </button>
        )}
      </div>
    </article>
  )
}

export default function Alerts() {
  const { id } = useCurrentModel()
  const [tab, setTab] = useState<'new' | 'acknowledged'>('new')
  const alerts = useAlerts(tab)
  const ack = useAcknowledge()
  const ackAll = useAcknowledgeAll()
  // ?part= (from a marker on the car, M55): only the alerts that are about that part
  const [params, setParams] = useSearchParams()
  const part = partName(params.get('part')) ? params.get('part') : null
  const list = (alerts.data ?? []).filter((a) => !part || alertPart(a) === part)
  const showAll = () =>
    setParams((p) => {
      const next = new URLSearchParams(p)
      next.delete('part')
      return next
    })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('page.alerts')}</h1>
          <p>
            Raised by the rules in <span className="mono">config/models/{id}/alerts.yaml</span> each time you run{' '}
            <span className="mono">make ingest</span>. Acknowledged alerts are not raised again.
          </p>
          {unitsKey() !== unitsKey(DEFAULT_UNITS) && (
            <p className="muted" style={{ fontSize: 12 }}>
              An alert's text is written when the data is loaded, so its figures stay in kPa, km and l/100 km whatever units you chose.
            </p>
          )}
        </div>
        {tab === 'new' && list.length > 1 && !part && (
          <button onClick={() => ackAll.mutate()} disabled={ackAll.isPending}>
            Acknowledge all
          </button>
        )}
      </div>

      {part && (
        <div className="alert-row" style={{ marginBottom: 14 }}>
          <b>About: {partName(part)}</b>
          <span className="muted">only the alerts that are about this part of the car</span>
          <button type="button" className="when" onClick={showAll}>Show all</button>
        </div>
      )}
      <div className="chips" role="tablist" style={{ marginBottom: 14 }}>
        {(['new', 'acknowledged'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`chip ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {(ack.isError || ackAll.isError) && (
        <div className="state error" role="alert" style={{ marginBottom: 14 }}>
          {(ack.error ?? ackAll.error)?.message}
        </div>
      )}

      <QueryState query={alerts}>
        {list.length === 0 ? (
          <Panel>
            <div className="state">{part ? `No ${tab === 'new' ? 'open' : 'acknowledged'} alert about this part.` : tab === 'new' ? 'All clear: no unacknowledged alerts.' : 'Nothing acknowledged yet.'}</div>
          </Panel>
        ) : (
          <div className="stack">
            {list.map((a) => (
              <AlertCard
                key={a.alert_id}
                alert={a}
                busy={ack.isPending}
                onAck={a.status === 'new' ? () => ack.mutate(a.alert_id) : undefined}
              />
            ))}
          </div>
        )}
      </QueryState>
    </>
  )
}
