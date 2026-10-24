import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDateRange } from '../range'
import { client } from './client'

/** from/to query parameters of the selected period (undefined = no limit). */
function useRangeQuery() {
  const { from, to } = useDateRange()
  return { from, to }
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

export const useSpan = () =>
  useQuery({ queryKey: ['span'], queryFn: () => unwrap(client.GET('/api/span')) })

export const useMonthly = () => {
  const range = useRangeQuery()
  return useQuery({
    queryKey: ['monthly', range],
    queryFn: () => unwrap(client.GET('/api/trends/monthly', { params: { query: range } })),
  })
}

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

export const useSnapshots = (ecu: string | undefined, dtc_code: string | undefined) =>
  useQuery({
    queryKey: ['snapshots', ecu, dtc_code],
    enabled: Boolean(ecu && dtc_code),
    queryFn: () =>
      unwrap(
        client.GET('/api/dtcs/snapshots', { params: { query: { ecu: ecu!, dtc_code: dtc_code! } } }),
      ),
  })

export const useDiagReports = () =>
  useQuery({ queryKey: ['diag-reports'], queryFn: () => unwrap(client.GET('/api/diag/reports')) })

/** The car's own oil-change countdown: a state, so it ignores the selected period. */
export const useOilService = () =>
  useQuery({ queryKey: ['oil'], queryFn: () => unwrap(client.GET('/api/maintenance/oil')) })

/** The car's own warning flags: a state, so it ignores the selected period. */
export const useCarWarnings = () =>
  useQuery({ queryKey: ['car-warnings'], queryFn: () => unwrap(client.GET('/api/status/car-warnings')) })

/** Tire pressures by the time the car measured them, for the selected period. */
export const useTires = () => {
  const range = useRangeQuery()
  return useQuery({
    queryKey: ['tires', range],
    queryFn: () => unwrap(client.GET('/api/status/tires', { params: { query: range } })),
  })
}

export const useDiagHistory = () =>
  useQuery({ queryKey: ['diag-history'], queryFn: () => unwrap(client.GET('/api/diag/history')) })

export const useDiagReport = (id: string | undefined) =>
  useQuery({
    queryKey: ['diag-report', id],
    enabled: Boolean(id),
    queryFn: () =>
      unwrap(client.GET('/api/diag/reports/{report_id}', { params: { path: { report_id: id! } } })),
  })

export const useDiagFrames = (id: string | undefined) =>
  useQuery({
    queryKey: ['diag-frames', id],
    enabled: Boolean(id),
    queryFn: () =>
      unwrap(
        client.GET('/api/diag/reports/{report_id}/frames', { params: { path: { report_id: id! } } }),
      ),
  })

export const useDiagCompare = (a: string | undefined, b: string | undefined) =>
  useQuery({
    queryKey: ['diag-compare', a, b],
    enabled: Boolean(a && b && a !== b),
    queryFn: () => unwrap(client.GET('/api/diag/compare', { params: { query: { a: a!, b: b! } } })),
  })

export const useFreezeFrames = (ecu: string | undefined, dtc_code: string | undefined) =>
  useQuery({
    queryKey: ['frames', ecu, dtc_code],
    enabled: Boolean(ecu && dtc_code),
    queryFn: () =>
      unwrap(client.GET('/api/dtcs/frames', { params: { query: { ecu: ecu!, dtc_code: dtc_code! } } })),
  })

export const useFaultContext = (transaction_id: string | undefined) =>
  useQuery({
    queryKey: ['fault-context', transaction_id],
    enabled: Boolean(transaction_id),
    queryFn: () =>
      unwrap(client.GET('/api/dtcs/context', { params: { query: { transaction_id: transaction_id! } } })),
  })

export const useUnmapped = () =>
  useQuery({ queryKey: ['unmapped'], queryFn: () => unwrap(client.GET('/api/codes/unmapped')) })

export const useAlerts = (status: 'new' | 'acknowledged') =>
  useQuery({
    queryKey: ['alerts', status],
    queryFn: () => unwrap(client.GET('/api/alerts', { params: { query: { status } } })),
  })

/** Acknowledging changes alert lists and the overview/nav counters. */
function useAlertMutation<T = void>(run: (arg: T) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['overview'] })
    },
  })
}

export const useAcknowledge = () =>
  useAlertMutation((alert_id: number) =>
    unwrap(client.POST('/api/alerts/{alert_id}/acknowledge', { params: { path: { alert_id } } })),
  )

export const useAcknowledgeAll = () =>
  useAlertMutation(() => unwrap(client.POST('/api/alerts/acknowledge-all')))
