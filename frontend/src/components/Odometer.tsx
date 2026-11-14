import { distanceLabel, toDistance } from '../units'

/** The odometer as a row of digits, in the reader's distance unit (the reading itself is in km). */
export function Odometer({ km }: { km: number | null | undefined }) {
  const value = toDistance(km)
  if (value === null) return <div className="odometer mono">—</div>
  const unit = distanceLabel()
  const [whole, tenth] = value.toFixed(1).split('.')
  const digits = whole.padStart(6, '0').split('')
  return (
    <div className="odometer" role="img" aria-label={`${value.toFixed(1)} ${unit === 'mi' ? 'miles' : 'kilometres'}`}>
      {digits.map((d, i) => (
        <span key={i}>{d}</span>
      ))}
      <span className="tenth">{tenth}</span>
      <span className="unit">{unit}</span>
    </div>
  )
}
