import type { ReactNode } from 'react'
import { useCurrentModel, useSwitchModel } from '../model'

/** What stands in for the pages when the model in the address is unknown or has no data yet. */
export function ModelGate({ children }: { children: ReactNode }) {
  const { models, model, notFound, requested } = useCurrentModel()
  const switchTo = useSwitchModel()
  if (notFound) {
    return (
      <div className="state error">
        <p>Unknown model <code>{requested}</code>. Choose one:</p>
        <p>
          {models.map((m) => (
            <button key={m.id} className="chip" onClick={() => switchTo(m.id)}>{m.name}</button>
          ))}
        </p>
      </div>
    )
  }
  if (model && !model.has_data) {
    return (
      <div className="state">
        No data for {model.name} yet: put its exports in <code>data/{model.id}/</code> and run{' '}
        <code>make ingest MODEL={model.id}</code>.
      </div>
    )
  }
  return <>{children}</>
}
