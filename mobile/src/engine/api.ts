/** The routes of the Python API, answered from the in-browser database (of the one car model loaded). */
import type { Ctx, Handler } from './context'
import { Con, type RawDb } from './db'
import { dateRange, type DateRange } from './dates'
import { HttpError, Query } from './http'
import { alertHandlers, MemoryAckStore, type AckStore } from './alerts'
import { diagCompare, diagHistory, diagReport, diagReportFrames, diagReports } from './diag'
import { dtcEvents, dtcFrequency, dtcReadouts, dtcSnapshots, faultContext, freezeFrames } from './faults'
import { carWarnings } from './carwarnings'
import { garage } from './garage'
import { maintenanceOil } from './maintenance'
import { warningFlagHints, warningFlags } from './warningflags'
import { alarms, doorsTimeline, fuelMonthly, odometerDaily, overview, span, statusTimeline, tireReadings, tripSegments } from './series'
import { activityPattern } from './activity'
import { frameSummary } from './framesummary'
import { occupancy } from './occupancy'
import type { PackBody } from './pack'
import { trendsMonthly } from './trends'
import { unmapped, warningDaily, warningEvents, warningFrequency } from './warnings'

export interface ApiResponse {
  status: number
  body: unknown
}

/** One entry of GET /api/models: the phone lists the models of the packs stored on it. */
export interface ModelInfo {
  id: string
  name: string
  platform: string | null
  default: boolean
  hidden_pages: string[]
  body: PackBody | null
  has_data: boolean
  first_day: string | null
  last_day: string | null
}

/** What the phone keeps of a car that is not loaded: its all-time monthly figures and its "All cars" card. */
export interface Summary {
  monthly?: unknown[]
  garage?: unknown
}

export interface ApiOptions {
  /** Where acknowledgements made on this phone are kept. */
  acks?: AckStore
  now?: () => Date
  /** Shown by /api/health (the Python API shows the database path). */
  database?: string
}

interface Route {
  method: 'GET' | 'POST'
  pattern: RegExp
  names: string[]
  handler: Handler
  needsData: boolean
}

export class Api {
  private con: Con | null = null
  private loadedModel: string | null = null
  private models: ModelInfo[] = []
  private summaries = new Map<string, Summary>()
  private readonly routes: Route[] = []
  private readonly database: string

  constructor(options: ApiOptions = {}) {
    this.database = options.database ?? 'data pack on this device'
    const alerts = alertHandlers(options.acks ?? new MemoryAckStore(), options.now ?? (() => new Date()))
    const add = (method: Route['method'], path: string, handler: Handler, needsData = true) => {
      const names: string[] = []
      const source = path.replace(/\{(\w+)\}/g, (_, n: string) => (names.push(n), '([^/]+)'))
      this.routes.push({ method, pattern: new RegExp(`^${source}$`), names, handler, needsData })
    }
    add('GET', '/api/health', async () => ({ status: 'ok', database: this.database, has_data: this.con !== null }), false)
    add('GET', '/api/models', async () => this.models, false)
    add('GET', '/api/span', span)
    add('GET', '/api/garage', garage)
    add('GET', '/api/overview', overview)
    add('GET', '/api/trends/monthly', trendsMonthly)
    add('GET', '/api/odometer/daily', odometerDaily)
    add('GET', '/api/fuel/monthly', fuelMonthly)
    add('GET', '/api/trips/segments', tripSegments)
    add('GET', '/api/status/timeline', statusTimeline)
    add('GET', '/api/status/tires', tireReadings)
    add('GET', '/api/doors/timeline', doorsTimeline)
    add('GET', '/api/alarms', alarms)
    add('GET', '/api/warnings/frequency', warningFrequency)
    add('GET', '/api/warnings/daily', warningDaily)
    add('GET', '/api/activity/pattern', activityPattern)
    add('GET', '/api/status/occupancy', occupancy)
    add('GET', '/api/warnings/events', warningEvents)
    add('GET', '/api/dtcs/frequency', dtcFrequency)
    add('GET', '/api/dtcs/events', dtcEvents)
    add('GET', '/api/dtcs/frame-summary', frameSummary)
    add('GET', '/api/dtcs/readouts', dtcReadouts)
    add('GET', '/api/dtcs/snapshots', dtcSnapshots)
    add('GET', '/api/codes/unmapped', unmapped)
    add('GET', '/api/maintenance/oil', maintenanceOil)
    add('GET', '/api/status/car-warnings', carWarnings)
    add('GET', '/api/status/warning-flags', warningFlags)
    add('GET', '/api/status/warning-flags/hints', warningFlagHints)
    add('GET', '/api/alerts', alerts.list)
    add('POST', '/api/alerts/acknowledge-all', alerts.acknowledgeAll)
    add('POST', '/api/alerts/{alert_id}/acknowledge', alerts.acknowledge)
    add('GET', '/api/diag/reports', diagReports)
    add('GET', '/api/diag/history', diagHistory)
    add('GET', '/api/diag/reports/{report_id}', diagReport)
    add('GET', '/api/diag/reports/{report_id}/frames', diagReportFrames)
    add('GET', '/api/diag/compare', diagCompare)
    add('GET', '/api/dtcs/frames', freezeFrames)
    add('GET', '/api/dtcs/context', faultContext)
  }

  /** The database to answer from (null = no data on this device yet: data routes answer 503), and the
   * car model it holds: a request that names another model is refused instead of answered from this one. */
  use(raw: RawDb | null, model: string | null = null): void {
    this.con = raw ? new Con(raw) : null
    this.loadedModel = raw ? model : null
  }

  /**
   * What the Compare and "All cars" pages need of cars that are not loaded: `/api/trends/monthly?model=<id>`
   * (without a period) and `/api/garage?model=<id>` are answered from here. Anything else about another model
   * is still refused.
   */
  setSummaries(summaries: Map<string, Summary>): void {
    this.summaries = summaries
  }

  /** What GET /api/models answers (the packs stored on this phone). */
  setModels(models: ModelInfo[]): void {
    this.models = models
  }

  async handle(method: string, url: string): Promise<ApiResponse> {
    const u = new URL(url, 'http://phone.invalid')
    const path = u.pathname
    let known = false
    for (const route of this.routes) {
      const m = route.pattern.exec(path)
      if (!m) continue
      known = true
      if (route.method !== method.toUpperCase()) continue
      try {
        const asked = u.searchParams.get('model')
        const cached =
          asked && method.toUpperCase() === 'GET'
            ? path === '/api/trends/monthly' && !u.searchParams.has('from') && !u.searchParams.has('to')
              ? this.summaries.get(asked)?.monthly
              : path === '/api/garage'
                ? this.summaries.get(asked)?.garage
                : undefined
            : undefined
        if (asked && cached !== undefined && this.loadedModel !== null && asked !== this.loadedModel) return { status: 200, body: cached }
        if (asked && path !== '/api/models' && this.loadedModel !== null && asked !== this.loadedModel) {
          // same answer as the Python API for a model it does not know
          const ids = this.models.map((x) => x.id).join(', ')
          throw new HttpError(404, `Unknown model '${asked}'; the models are: ${ids}`)
        }
        if (route.needsData && !this.con) {
          throw new HttpError(503, 'No data on this phone yet - import a data pack first')
        }
        const q = new Query(u.searchParams)
        let range: DateRange | undefined
        const ctx: Ctx = {
          con: this.con!,
          q,
          range: () => (range ??= dateRange(q)),
          path: Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(m[i + 1])])),
        }
        return { status: 200, body: await route.handler(ctx) }
      } catch (e) {
        if (e instanceof HttpError) return { status: e.status, body: { detail: e.detail } }
        throw e
      }
    }
    return known
      ? { status: 405, body: { detail: 'Method Not Allowed' } }
      : { status: 404, body: { detail: 'Not Found' } }
  }
}

/** A `fetch` that answers `/api/...` from the engine and anything else from the network. */
export function createFetch(api: Api, passthrough: typeof fetch = globalThis.fetch): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/') && url.pathname !== '/api') return passthrough(input, init)
    const { status, body } = await api.handle(request.method, url.pathname + url.search)
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }
}
