import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import createClient from 'openapi-fetch'
import type { paths } from './schema'

const client = createClient<paths>({ baseUrl: '' })

type Result<T> = { data?: T; error?: unknown; response: Response }

async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  const { data, error, response } = await request
  if (data === undefined) {
    const detail = (error as { detail?: unknown } | undefined)?.detail
    throw new Error(typeof detail === 'string' ? detail : `Request failed (${response.status})`)
  }
  return data
}

export const useOverview = () =>
  useQuery({ queryKey: ['overview'], queryFn: () => unwrap(client.GET('/api/overview')) })

export const useOdometerDaily = () =>
  useQuery({ queryKey: ['odometer'], queryFn: () => unwrap(client.GET('/api/odometer/daily')) })

export const useFuelMonthly = () =>
  useQuery({ queryKey: ['fuel'], queryFn: () => unwrap(client.GET('/api/fuel/monthly')) })

export const useTripSegments = (limit = 200) =>
  useQuery({
    queryKey: ['segments', limit],
    queryFn: () => unwrap(client.GET('/api/trips/segments', { params: { query: { limit } } })),
  })

export const useStatusTimeline = () =>
  useQuery({ queryKey: ['status'], queryFn: () => unwrap(client.GET('/api/status/timeline')) })

export const useDoors = (limit = 50) =>
  useQuery({
    queryKey: ['doors', limit],
    queryFn: () => unwrap(client.GET('/api/doors/timeline', { params: { query: { limit } } })),
  })

export const useAlarms = () =>
  useQuery({ queryKey: ['alarms'], queryFn: () => unwrap(client.GET('/api/alarms')) })

export const useWarningFrequency = () =>
  useQuery({
    queryKey: ['warning-frequency'],
    queryFn: () => unwrap(client.GET('/api/warnings/frequency')),
  })

export const useWarningDaily = () =>
  useQuery({ queryKey: ['warning-daily'], queryFn: () => unwrap(client.GET('/api/warnings/daily')) })

export const useWarningEvents = (code: string | undefined, offset: number, limit = 25) =>
  useQuery({
    queryKey: ['warning-events', code, offset, limit],
    queryFn: () =>
      unwrap(client.GET('/api/warnings/events', { params: { query: { code, offset, limit } } })),
    placeholderData: keepPreviousData,
  })

export const useDtcFrequency = () =>
  useQuery({ queryKey: ['dtc-frequency'], queryFn: () => unwrap(client.GET('/api/dtcs/frequency')) })

export const useDtcEvents = (ecu?: string, dtc_code?: string) =>
  useQuery({
    queryKey: ['dtc-events', ecu, dtc_code],
    queryFn: () => unwrap(client.GET('/api/dtcs/events', { params: { query: { ecu, dtc_code } } })),
  })

export const useReadouts = () =>
  useQuery({ queryKey: ['readouts'], queryFn: () => unwrap(client.GET('/api/dtcs/readouts')) })

export const useSnapshots = (ecu: string | undefined, dtc_code: string | undefined) =>
  useQuery({
    queryKey: ['snapshots', ecu, dtc_code],
    enabled: Boolean(ecu && dtc_code),
    queryFn: () =>
      unwrap(
        client.GET('/api/dtcs/snapshots', { params: { query: { ecu: ecu!, dtc_code: dtc_code! } } }),
      ),
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
