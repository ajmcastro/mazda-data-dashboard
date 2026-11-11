import { useEffect, type ReactNode } from 'react'
import { useController, useData } from './data'

/**
 * Pages about several cars on the phone (Compare, All cars). The engine holds one car at a time, so before
 * they open every stored car must have its figures cached (the controller loads the ones that have none, one
 * after the other, and goes back to the car that was shown). A failure is shown once instead of being retried.
 */
export default function SummaryGate({ children }: { children: ReactNode }) {
  const controller = useController()
  const { packs, summaries, preparing, error } = useData()
  const missing = packs.some((p) => !summaries.includes(p.id))

  useEffect(() => {
    if (missing && !preparing && !error) void controller.prepareComparison()
  }, [controller, missing, preparing, error])

  if (error && missing) {
    return (
      <div className="state error" role="alert">
        {error}
        <button type="button" className="linklike" onClick={() => controller.clearError()}>Dismiss</button>
      </div>
    )
  }
  if (missing) return <div className="state" role="status">Preparing the figures of every car…</div>
  return <>{children}</>
}
