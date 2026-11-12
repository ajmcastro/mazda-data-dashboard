import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDateRange, useModelParam } from '../range'
import { client } from './client'

/** from/to of the selected period (undefined = no limit) and the car model (undefined = the default one).
 * Spread into the request and used in the query key, so another model never shows cached figures. */
function useRangeQuery() {
  const { from, to } = useDateRange()
  const model = useModelParam()
  return { from, to, model }
}

type Result<T> = { data?: T; error?: unknown; response: Response }

async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  const { data, error, response } = await request
  if (data === undefined) {
    const detail = (error as { detail?: unknown } | undefined)?.detail
    throw new Error(typeof detail === 'string' ? detail : `Request failed (${response.status})`)
  }
  return data
}

export const useOverview = () => {
  const range = useRangeQuery()
  return useQuery({
    queryKey: ['overview', range],
    queryFn: () => unwrap(client.GET('/api/overview', { params: { query: range } })),
  })
}

/** The car models, with what data each has. The phone app has no such route (one pack, one model). */
export const useModels = () =>
  useQuery({
    queryKey: ['models'],
    queryFn: () => unwrap(client.GET('/api/models')),
    retry: false,
    staleTime: 60_000,
  })

export const useSpan = () => {
  const { model } = useRangeQuery()
  return useQuery({
    queryKey: ['span', model],
    queryFn: () => unwrap(client.GET('/api/span', { params: { query: { model } } })),
  })
}

export const useMonthly = () => {
  const range = useRangeQuery()
  return useQuery({
    queryKey: ['monthly', range],
    queryFn: () => unwrap(client.GET('/api/trends/monthly', { params: { query: range } })),
  })
}

/** One model's monthly figures over all its data (the Compare page needs two models at once, and no period). */
export const useMonthlyOf = (model: string | undefined) =>
  useQuery({
    queryKey: ['monthly-of', model],
    enabled: Boolean(model),
    queryFn: () => unwrap(client.GET('/api/trends/monthly', { params: { query: { model } } })),
  })

/** The "All cars" card of one model (the same options are used for every car and by the model selector). */
export const garageQuery = (model: string | undefined) => ({
  queryKey: ['garage', model],
  enabled: Boolean(model),
  retry: false,
  queryFn: () => unwrap(client.GET('/api/garage', { params: { query: { model } } })),
})

export const useGarageOf = (model: string | undefined) => useQuery(garageQuery(model))

/** A model's months inside a period (a month cut by the period only counts its days inside it): the Compare page's periods. */
export const useMonthlyRange = (model: string | undefined, from: string | undefined, to: string | undefined) =>
  useQuery({
    queryKey: ['monthly-range', model, from, to],
    enabled: Boolean(from && to),
    queryFn: () => unwrap(client.GET('/api/trends/monthly', { params: { query: { model, from, to } } })),
  })

export const useOdometerDaily = () => {
  const range = useRangeQuery()
  return useQuery({
    queryKey: ['odometer', range],
    queryFn: () => unwrap(client.GET('/api/odometer/daily', { params: { query: range } })),
  })
}

export const useFuelMonthly = () => {
  const range = useRangeQuery()
  return useQuery({
    queryKey: ['fuel', range],
    queryFn: () => unwrap(client.GET('/api/fuel/monthly', { params: { query: range } })),
  })
}

export const useTripSegments = (limit = 200) => {
  const range = useRangeQuery()
  return useQuery({
    queryKey: ['segments', limit, range],
    queryFn: () =>
      unwrap(client.GET('/api/trips/segments', { params: { query: { limit, ...range } } })),
  })
}

export const useStatusTimeline = () => {
  const range = useRangeQuery()
  return useQuery({
    queryKey: ['status', range],
    queryFn: () => unwrap(client.GET('/api/status/timeline', { params: { query: range } })),
  })
}

export const useDoors = (limit = 50) => {
  const range = useRangeQuery()
  return useQuery({
    queryKey: ['doors', limit, range],
    queryFn: () =>
      unwrap(client.GET('/api/doors/timeline', { params: { query: { limit, ...range } } })),
  })
}

export const useAlarms = () => {
  const range = useRangeQuery()
  return useQuery({
    queryKey: ['alarms', range],
    queryFn: () => unwrap(client.GET('/api/alarms', { params: { query: range } })),
  })
}

export const useWarningFrequency = () => {
  const range = useRangeQuery()
  return useQuery({
    queryKey: ['warning-frequency', range],
    queryFn: () => unwrap(client.GET('/api/warnings/frequency', { params: { query: range } })),
  })
}

export const useWarningDaily = () => {
  const range = useRangeQuery()
  return useQuery({
    queryKey: ['warning-daily', range],
    queryFn: () => unwrap(client.GET('/api/warnings/daily', { params: { query: range } })),
  })
}

export const useActivityPattern = () => {
  const range = useRangeQuery()
  return useQuery({
    queryKey: ['activity-pattern', range],
    queryFn: () => unwrap(client.GET('/api/activity/pattern', { params: { query: range } })),
  })
}

export const useWarningEvents = (code: string | undefined, offset: number, limit = 25) => {
  const range = useRangeQuery()
  return useQuery({
    queryKey: ['warning-events', code, offset, limit, range],
    queryFn: () =>
      unwrap(
        client.GET('/api/warnings/events', { params: { query: { code, offset, limit, ...range } } }),
      ),
    placeholderData: keepPreviousData,
  })
}

export const useDtcFrequency = () => {
  const range = useRangeQuery()
  return useQuery({
    queryKey: ['dtc-frequency', range],
    queryFn: () => unwrap(client.GET('/api/dtcs/frequency', { params: { query: range } })),
  })
}

export const useDtcEvents = (ecu?: string, dtc_code?: string) => {
  const range = useRangeQuery()
  return useQuery({
    queryKey: ['dtc-events', ecu, dtc_code, range],
    queryFn: () =>
      unwrap(client.GET('/api/dtcs/events', { params: { query: { ecu, dtc_code, ...range } } })),
  })
}

export const useReadouts = () => {
  const range = useRangeQuery()
  return useQuery({
    queryKey: ['readouts', range],
    queryFn: () => unwrap(client.GET('/api/dtcs/readouts', { params: { query: range } })),
  })
}

export const useSnapshots = (ecu: string | undefined, dtc_code: string | undefined) => {
  const { model } = useRangeQuery()
  return useQuery({
    queryKey: ['snapshots', model, ecu, dtc_code],
    enabled: Boolean(ecu && dtc_code),
    queryFn: () =>
      unwrap(
        client.GET('/api/dtcs/snapshots', {
          params: { query: { ecu: ecu!, dtc_code: dtc_code!, model } },
        }),
      ),
  })
}

export const useDiagReports = () => {
  const { model } = useRangeQuery()
  return useQuery({
    queryKey: ['diag-reports', model],
    queryFn: () => unwrap(client.GET('/api/diag/reports', { params: { query: { model } } })),
  })
}

/** The car's own oil-change countdown: a state, so it ignores the selected period. */
export const useOilService = () => {
  const { model } = useRangeQuery()
  return useQuery({
    queryKey: ['oil', model],
    queryFn: () => unwrap(client.GET('/api/maintenance/oil', { params: { query: { model } } })),
  })
}

/** The car's own warning flags: a state, so it ignores the selected period. */
export const useCarWarnings = () => {
  const { model } = useRangeQuery()
  return useQuery({
    queryKey: ['car-warnings', model],
    queryFn: () => unwrap(client.GET('/api/status/car-warnings', { params: { query: { model } } })),
  })
}

/** Tire pressures by the time the car measured them, for the selected period. */
export const useTires = () => {
  const range = useRangeQuery()
  return useQuery({
    queryKey: ['tires', range],
    queryFn: () => unwrap(client.GET('/api/status/tires', { params: { query: range } })),
  })
}

/** The car's warning-lamp bit flags that ever change: a state, so it ignores the selected period. */
export const useWarningFlags = () => {
  const { model } = useRangeQuery()
  return useQuery({
    queryKey: ['warning-flags', model],
    queryFn: () => unwrap(client.GET('/api/status/warning-flags', { params: { query: { model } } })),
  })
}

/** What happens around the times a flag is on (loaded when a flag is opened). */
export const useFlagHints = (flag: string | undefined, windowHours: number) => {
  const { model } = useRangeQuery()
  return useQuery({
    queryKey: ['flag-hints', model, flag, windowHours],
    enabled: Boolean(flag),
    queryFn: () =>
      unwrap(
        client.GET('/api/status/warning-flags/hints', {
          params: { query: { flag: flag!, window_hours: windowHours, model } },
        }),
      ),
  })
}

export const useDiagHistory = () => {
  const { model } = useRangeQuery()
  return useQuery({
    queryKey: ['diag-history', model],
    queryFn: () => unwrap(client.GET('/api/diag/history', { params: { query: { model } } })),
  })
}

export const useDiagReport = (id: string | undefined) => {
  const { model } = useRangeQuery()
  return useQuery({
    queryKey: ['diag-report', model, id],
    enabled: Boolean(id),
    queryFn: () =>
      unwrap(
        client.GET('/api/diag/reports/{report_id}', {
          params: { path: { report_id: id! }, query: { model } },
        }),
      ),
  })
}

export const useDiagFrames = (id: string | undefined) => {
  const { model } = useRangeQuery()
  return useQuery({
    queryKey: ['diag-frames', model, id],
    enabled: Boolean(id),
    queryFn: () =>
      unwrap(
        client.GET('/api/diag/reports/{report_id}/frames', {
          params: { path: { report_id: id! }, query: { model } },
        }),
      ),
  })
}

export const useDiagCompare = (a: string | undefined, b: string | undefined) => {
  const { model } = useRangeQuery()
  return useQuery({
    queryKey: ['diag-compare', model, a, b],
    enabled: Boolean(a && b && a !== b),
    queryFn: () =>
      unwrap(client.GET('/api/diag/compare', { params: { query: { a: a!, b: b!, model } } })),
  })
}

export const useFreezeFrames = (ecu: string | undefined, dtc_code: string | undefined) => {
  const { model } = useRangeQuery()
  return useQuery({
    queryKey: ['frames', model, ecu, dtc_code],
    enabled: Boolean(ecu && dtc_code),
    queryFn: () =>
      unwrap(
        client.GET('/api/dtcs/frames', {
          params: { query: { ecu: ecu!, dtc_code: dtc_code!, model } },
        }),
      ),
  })
}

export const useFaultContext = (transaction_id: string | undefined) => {
  const { model } = useRangeQuery()
  return useQuery({
    queryKey: ['fault-context', model, transaction_id],
    enabled: Boolean(transaction_id),
    queryFn: () =>
      unwrap(
        client.GET('/api/dtcs/context', {
          params: { query: { transaction_id: transaction_id!, model } },
        }),
      ),
  })
}

export const useUnmapped = () => {
  const { model } = useRangeQuery()
  return useQuery({
    queryKey: ['unmapped', model],
    queryFn: () => unwrap(client.GET('/api/codes/unmapped', { params: { query: { model } } })),
  })
}

export const useAlerts = (status: 'new' | 'acknowledged') => {
  const { model } = useRangeQuery()
  return useQuery({
    queryKey: ['alerts', model, status],
    queryFn: () => unwrap(client.GET('/api/alerts', { params: { query: { status, model } } })),
  })
}

/** Acknowledging changes alert lists and the overview/nav counters (of the model shown). */
function useAlertMutation<T = void>(run: (arg: T, model: string | undefined) => Promise<unknown>) {
  const queryClient = useQueryClient()
  const { model } = useRangeQuery()
  return useMutation({
    mutationFn: (arg: T) => run(arg, model),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['overview'] })
      void queryClient.invalidateQueries({ queryKey: ['garage'] })
    },
  })
}

export const useAcknowledge = () =>
  useAlertMutation((alert_id: number, model) =>
    unwrap(
      client.POST('/api/alerts/{alert_id}/acknowledge', {
        params: { path: { alert_id }, query: { model } },
      }),
    ),
  )

export const useAcknowledgeAll = () =>
  useAlertMutation((_: void, model) =>
    unwrap(client.POST('/api/alerts/acknowledge-all', { params: { query: { model } } })),
  )
