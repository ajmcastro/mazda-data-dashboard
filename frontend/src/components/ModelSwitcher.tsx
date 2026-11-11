import { useCurrentModel, useSwitchModel } from '../model'

/** Chooses which car model the dashboard shows. Hidden when there is only one model. */
export function ModelSwitcher() {
  const { models, model, multi } = useCurrentModel()
  const switchTo = useSwitchModel()
  if (!multi) return null
  return (
    <label className="model-switch">
      <span className="sr-only">Car model</span>
      <select value={model?.id ?? models[0]!.id} onChange={(e) => switchTo(e.target.value)}>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {m.has_data ? '' : ' (no data yet)'}
          </option>
        ))}
      </select>
    </label>
  )
}
