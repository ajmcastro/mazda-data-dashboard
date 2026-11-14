import {
  CONSUMPTION_LABEL, CONSUMPTION_UNITS, DISTANCE_UNITS, PRESSURE_UNITS, useUnits,
  type ConsumptionUnit, type DistanceUnit, type PressureUnit,
} from '../units'

/**
 * The units figures are shown in: pressure, fuel consumption and distance (PLAN.md M45). A choice per device,
 * like the appearance next to it; the data itself stays in kPa, l/100 km and km.
 */
export function UnitsControl({ className = '' }: { className?: string }) {
  const [units, setUnits] = useUnits()
  return (
    <div className={`units-control ${className}`} role="group" aria-label="Units">
      <select
        aria-label="Pressure unit"
        value={units.pressure}
        onChange={(e) => setUnits({ ...units, pressure: e.target.value as PressureUnit })}
      >
        {PRESSURE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
      <select
        aria-label="Fuel consumption unit"
        value={units.consumption}
        onChange={(e) => setUnits({ ...units, consumption: e.target.value as ConsumptionUnit })}
      >
        {CONSUMPTION_UNITS.map((u) => <option key={u} value={u}>{CONSUMPTION_LABEL[u]}</option>)}
      </select>
      <select
        aria-label="Distance unit"
        value={units.distance}
        onChange={(e) => setUnits({ ...units, distance: e.target.value as DistanceUnit })}
      >
        {DISTANCE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
    </div>
  )
}
