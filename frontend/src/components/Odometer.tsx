export function Odometer({ km }: { km: number | null | undefined }) {
  if (km === null || km === undefined) return <div className="odometer mono">—</div>
  const [whole, tenth] = km.toFixed(1).split('.')
  const digits = whole.padStart(6, '0').split('')
  return (
    <div className="odometer" role="img" aria-label={`${km.toFixed(1)} kilometres`}>
      {digits.map((d, i) => (
        <span key={i}>{d}</span>
      ))}
      <span className="tenth">{tenth}</span>
      <span className="unit">km</span>
    </div>
  )
}
