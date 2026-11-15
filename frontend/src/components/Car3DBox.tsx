import { Component, lazy, Suspense, useState, type ReactNode } from 'react'
import type { CarState } from '../car'
import type { Body } from '../car3d/shapes/common'

// three.js stays in its own chunk: the 3D view is loaded only when a box is shown
const Car3D = lazy(() => import('../car3d/Car3D'))

class Guard extends Component<{ onError: () => void; children: ReactNode }, { broken: boolean }> {
  state = { broken: false }
  static getDerivedStateFromError() {
    return { broken: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    return this.state.broken ? null : this.props.children
  }
}

/** A car in 3D for a page other than Status, with `fallback` shown while it loads and when 3D is not possible. */
export function Car3DBox({ car, body, fallback }: { car: CarState; body?: Partial<Body>; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <>{fallback}</>
  return (
    <Guard onError={() => setFailed(true)}>
      <Suspense fallback={fallback}>
        <Car3D car={car} body={body} onFail={() => setFailed(true)} />
      </Suspense>
    </Guard>
  )
}
