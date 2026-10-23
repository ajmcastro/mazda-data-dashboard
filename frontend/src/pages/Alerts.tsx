import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAcknowledge, useAcknowledgeAll, useAlerts } from '../api/hooks'
import type { Alert } from '../api/types'
import { Badge, Panel, QueryState } from '../components/ui'
import { fmtDateTime } from '../lib'

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
        {alert.link && alert.link !== '/alerts' && <Link to={alert.link}>View →</Link>}
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
  const [tab, setTab] = useState<'new' | 'acknowledged'>('new')
  const alerts = useAlerts(tab)
  const ack = useAcknowledge()
  const ackAll = useAcknowledgeAll()
  const list = alerts.data ?? []

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Alerts</h1>
          <p>
            Raised by the rules in <span className="mono">config/alerts.yaml</span> each time you run{' '}
            <span className="mono">make ingest</span>. Acknowledged alerts are not raised again.
          </p>
        </div>
        {tab === 'new' && list.length > 1 && (
          <button onClick={() => ackAll.mutate()} disabled={ackAll.isPending}>
            Acknowledge all
          </button>
        )}
      </div>

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
            <div className="state">{tab === 'new' ? 'All clear: no unacknowledged alerts.' : 'Nothing acknowledged yet.'}</div>
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
