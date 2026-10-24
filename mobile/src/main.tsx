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
import App from './App'
import { DataController } from './controller'
import { DataProvider } from './data'
import { createFetch } from './engine/api'
import { startBrowserEngine } from './engine-browser'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } },
})

async function fetchDemo(): Promise<Uint8Array> {
  const res = await fetch('./demo.cx5pack')
  const bytes = new Uint8Array(await res.arrayBuffer())
  // a missing file may come back as the app's own page: a zip starts with "PK"
  if (!res.ok || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('This build has no demo data.')
  return bytes
}

const controller = new DataController({
  startEngine: startBrowserEngine,
  fetchDemo,
  onDataChanged: () => queryClient.clear(),
})
setFetch(createFetch(controller.api))
void controller.init()

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
