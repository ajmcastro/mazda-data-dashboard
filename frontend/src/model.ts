import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useModels } from './api/hooks'
import { pickModel, rangeForModel, restoreModel } from './lib'
import { useDateRange, useModelParam } from './range'

/** What the pages say when the server cannot list models (the phone app: one pack, one model). */
const FALLBACK = { id: 'cx5', name: 'Mazda CX-5' }

/** The model the address names (or the default one) with the list it is picked from. */
export function useCurrentModel() {
  const requested = useModelParam()
  const query = useModels()
  const models = query.data ?? []
  const { model, notFound } = pickModel(query.data, requested)
  return {
    models,
    model,
    notFound,
    requested,
    /** the list has arrived, or failed (so that waiting for it can end) */
    settled: !query.isPending,
    id: model?.id ?? requested ?? FALLBACK.id,
    name: model?.name ?? FALLBACK.name,
  }
}

const STORAGE_KEY = 'cx5.model'

export function saveModelChoice(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* storage can be blocked (private window); the app works without it */
  }
}

function loadModelChoice(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * On the first load without a model in the address, bring back the last one chosen. Returns true
 * once that is settled *and the address shows it*, so the period is restored for the right model
 * (restoring it earlier would build on the old address and drop the model again).
 */
export function useRestoreSavedModel(): boolean {
  const { models, settled, requested } = useCurrentModel()
  const [, setParams] = useSearchParams()
  const [target, setTarget] = useState<string | null | undefined>(undefined) // undefined: not decided yet
  const done = useRef(false)

  useEffect(() => {
    if (done.current || !settled) return
    done.current = true
    const id = restoreModel(loadModelChoice(), models, requested) ?? null
    setTarget(id)
    if (id) {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          p.set('model', id)
          return p
        },
        { replace: true },
      )
    }
  }, [settled, models, requested, setParams])

  return target !== undefined && (target === null || requested === target)
}

/**
 * Switch to another model: the period is carried over as far as it makes sense there, and what
 * belongs to a model (the chosen report and comparison) is dropped.
 */
export function useSwitchModel() {
  const { models, model } = useCurrentModel()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { from, to } = useDateRange()

  /** `page`: go to that page (e.g. '/') in the same step, instead of staying where you are. */
  return (id: string, page?: string) => {
    const next = models.find((m) => m.id === id)
    if (!next) return
    saveModelChoice(id)
    const range = rangeForModel(
      { from, to },
      { first: model?.first_day, last: model?.last_day },
      { first: next.first_day, last: next.last_day },
    )
    const change = (prev: URLSearchParams) => {
      const p = new URLSearchParams(prev)
      if (next.default) p.delete('model')
      else p.set('model', next.id)
      for (const key of ['report', 'compare']) p.delete(key)
      for (const key of ['from', 'to'] as const) {
        if (range[key]) p.set(key, range[key])
        else p.delete(key)
      }
      return p
    }
    // two separate navigations would race (the second one drops the first one's parameters)
    if (page) navigate({ pathname: page, search: change(params).toString() }, { replace: true })
    else setParams(change, { replace: true })
  }
}
