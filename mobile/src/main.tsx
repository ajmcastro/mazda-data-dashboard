import '@fontsource/big-shoulders-display/latin-500'
import '@fontsource/big-shoulders-display/latin-700'
import '@fontsource/big-shoulders-display/latin-800'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@frontend/index.css'
import './mobile.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { setFetch } from '@frontend/api/client'
import { initTheme } from '@frontend/theme'
import App from './App'
import { DataController } from './controller'
import { DataProvider } from './data'
import { createFetch } from './engine/api'
import { startBrowserEngine } from './engine-browser'
import { registerServiceWorker } from './pwa'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } },
})

// one synthetic pack per demo model (make mobile-demo-pack); the first one is shown
const DEMO_PACKS = ['./demo-cx5.cx5pack', './demo-cx60.cx5pack']

async function fetchDemo(): Promise<Uint8Array[]> {
  return Promise.all(
    DEMO_PACKS.map(async (url) => {
      const res = await fetch(url)
      const bytes = new Uint8Array(await res.arrayBuffer())
      // a missing file may come back as the app's own page: a zip starts with "PK"
      if (!res.ok || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('This build has no demo data.')
      return bytes
    }),
  )
}

/** `#/status?model=cx60`: the model a link asks for, so the app opens on it. */
const requestedModel = new URLSearchParams(location.hash.split('?')[1] ?? '').get('model')

const controller = new DataController({
  startEngine: startBrowserEngine,
  fetchDemo,
  onDataChanged: () => queryClient.clear(),
})
setFetch(createFetch(controller.api))
initTheme()
void controller.init(requestedModel)
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider controller={controller}>
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <App />
        </HashRouter>
      </QueryClientProvider>
    </DataProvider>
  </StrictMode>,
)
