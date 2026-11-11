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
  if (listed.length < 2) return null
  return (
    <label className="model-switch">
      <span className="sr-only">Car model</span>
      <select value={model?.id ?? listed[0]!.id} onChange={(e) => switchTo(e.target.value)}>
        {listed.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {m.has_data ? '' : ' (no data yet)'}
          </option>
        ))}
      </select>
    </label>
  )
}
