import { useQueries } from '@tanstack/react-query'
import { garageQuery } from '../api/hooks'
import { optionLabel } from '../garage'
import { useCurrentModel, useSwitchModel } from '../model'

/**
 * Chooses which car model the dashboard shows. Models without data stay out of the list (a set-up
 * model nobody has loaded yet is noise), unless the address names one: then it is listed so the
 * message about it makes sense. Hidden when fewer than two models are left.
 */
export function ModelSwitcher() {
  const { models, model } = useCurrentModel()
  const switchTo = useSwitchModel()
  const listed = models.filter((m) => m.has_data || m.id === model?.id)
  // the new alerts of every car, so another car's alerts are seen before switching (a car without an answer shows none)
  const alerts = useQueries({ queries: listed.map((m) => garageQuery(m.has_data ? m.id : undefined)) }).map((q) => (q.data?.has_data ? q.data.alerts_new : undefined))
  if (listed.length < 2) return null
  return (
    <label className="model-switch">
      <span className="sr-only">Car model</span>
      <select value={model?.id ?? listed[0]!.id} onChange={(e) => switchTo(e.target.value)}>
        {listed.map((m, i) => (
          <option key={m.id} value={m.id}>
            {optionLabel(m.name, alerts[i], m.has_data)}
          </option>
        ))}
      </select>
    </label>
  )
}
