/* Service worker of the phone app. `vite build` fills in VERSION and PRECACHE (see vite.config.ts).
 * Everything the app needs is cached when it is installed, so it opens without a connection.
 * A new version waits until the user taps "Update" (the page then sends SKIP_WAITING). */
const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__
const CACHE = `cx5-${VERSION}`

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((path) => new URL(path, self.registration.scope).href))),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('cx5-') && key !== CACHE) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const hit = await cache.match(request, { ignoreSearch: true, ignoreVary: true })
      if (hit) return hit
      if (request.mode === 'navigate') {
        const page = await cache.match(new URL('index.html', self.registration.scope).href, { ignoreVary: true })
        if (page) return page
      }
      return fetch(request)
    })(),
  )
})
