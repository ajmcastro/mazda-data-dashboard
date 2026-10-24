/**
 * Service worker registration and its two facts the UI shows: whether the app is saved for use
 * without a connection, and whether a newer version is waiting. Only active in a production build
 * (the dev server must never cache anything).
 */
import { useSyncExternalStore } from 'react'

export interface PwaState {
  /** the service worker is active and has cached the app */
  offlineReady: boolean
  /** a newer version is installed and waiting for the user's go-ahead */
  updateReady: boolean
  /** false in `make mobile-dev` and in browsers without service workers */
  supported: boolean
}

let state: PwaState = { offlineReady: false, updateReady: false, supported: false }
let registration: ServiceWorkerRegistration | undefined
const listeners = new Set<() => void>()

function set(patch: Partial<PwaState>): void {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  set({ supported: true })
  const hadController = !!navigator.serviceWorker.controller
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // the first install also claims the page: only an update replaces the running code
    if (!hadController || reloading) return
    reloading = true
    location.reload()
  })
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      registration = reg
      if (reg.waiting && navigator.serviceWorker.controller) set({ updateReady: true })
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) set({ updateReady: true })
        })
      })
      return navigator.serviceWorker.ready
    })
    .then(() => set({ offlineReady: true }))
    .catch(() => undefined)
}

/** Switches to the waiting version; the page reloads itself once it has taken over. */
export function applyUpdate(): void {
  registration?.waiting?.postMessage('SKIP_WAITING')
}

export function usePwa(): PwaState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => state,
  )
}
