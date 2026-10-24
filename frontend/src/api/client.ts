import createClient from 'openapi-fetch'
import type { paths } from './schema'

/**
 * The API client every hook uses. The Mac app talks to the server through the browser's `fetch`;
 * the phone app (`mobile/`) has no server and swaps in its own `fetch` with `setFetch`, which
 * answers `/api/...` from the data on the device.
 */
let send: typeof fetch = (input, init) => globalThis.fetch(input, init)

export function setFetch(replacement: typeof fetch): void {
  send = replacement
}

export const client = createClient<paths>({ baseUrl: '', fetch: (request) => send(request) })
