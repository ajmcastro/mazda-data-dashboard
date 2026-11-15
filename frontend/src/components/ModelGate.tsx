import { tr } from '../i18n'
import { useLocation } from 'react-router-dom'
import { useWritable } from '../api/hooks'
import { RangeLink } from './RangeLink'
import type { ReactNode } from 'react'
import { useCurrentModel, useSwitchModel } from '../model'

/** What stands in for the pages when the model in the address is unknown or has no data yet. */
export function ModelGate({ children }: { children: ReactNode }) {
  const { models, model, notFound, requested } = useCurrentModel()
  const switchTo = useSwitchModel()
  const writable = useWritable()
  const { pathname } = useLocation()
  if (notFound) {
    return (
      <div className="state error">
        <p>{tr('Unknown model')} <code>{requested}</code>{tr('. Choose one:')}</p>
        <p>
          {models.map((m) => (
            <button key={m.id} className="chip" onClick={() => switchTo(m.id)}>{m.name}</button>
          ))}
        </p>
      </div>
    )
  }
  if (model && !model.has_data) {
    // the import page is how a car gets its first data without a terminal (M53): it stays reachable
    if (writable && pathname === '/import') return <>{children}</>
    return (
      <div className="state">
        No data for {model.name} yet: put its exports in <code>data/{model.id}/</code> and run{' '}
        <code>make ingest MODEL={model.id}</code>
        {writable ? <>{tr(', or')} <RangeLink to="/import">{tr('import them here')}</RangeLink>.</> : '.'}
      </div>
    )
  }
  return <>{children}</>
}
