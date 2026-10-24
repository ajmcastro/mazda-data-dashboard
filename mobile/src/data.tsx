import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { DataController, DataState } from './controller'

const Ctx = createContext<DataController | null>(null)

export function DataProvider({ controller, children }: { controller: DataController; children: ReactNode }) {
  return <Ctx.Provider value={controller}>{children}</Ctx.Provider>
}

export function useController(): DataController {
  const c = useContext(Ctx)
  if (!c) throw new Error('DataProvider is missing')
  return c
}

export function useData(): DataState {
  const c = useController()
  return useSyncExternalStore(c.subscribe, c.getState)
}
