import { fmtNum } from '../lib'

type Props = { fl?: number | null; fr?: number | null; rl?: number | null; rr?: number | null }

/** Top-down car outline with the four tire pressures (kPa); the lowest one is highlighted. */
export function Tires({ fl, fr, rl, rr }: Props) {
  const values = [fl, fr, rl, rr].filter((v): v is number => typeof v === 'number')
  const lowest = values.length ? Math.min(...values) : undefined
  const spread = values.length ? Math.max(...values) - Math.min(...values) : 0
  const tire = (x: number, y: number, v: number | null | undefined, name: string) => (
    <g key={name}>
      <rect x={x} y={y} width="30" height="58" rx="7" fill="var(--panel-2)" stroke={v === lowest && spread >= 20 ? 'var(--amber)' : 'var(--line)'} strokeWidth="2" />
      <text x={x + 15} y={y + 34} textAnchor="middle" fontFamily="var(--mono)" fontSize="13" fontWeight="600" fill="var(--text)">
        {fmtNum(v)}
      </text>
      <title>{`${name}: ${fmtNum(v, 0, 'kPa')}`}</title>
    </g>
  )
  return (
    <div className="tires">
      <svg viewBox="0 0 200 250" role="img" aria-label="Tire pressures in kilopascals">
        <rect x="52" y="14" width="96" height="222" rx="38" fill="none" stroke="var(--line)" strokeWidth="2" />
        <rect x="64" y="64" width="72" height="56" rx="10" fill="none" stroke="var(--line)" strokeWidth="1.5" />
        <rect x="64" y="132" width="72" height="62" rx="10" fill="none" stroke="var(--line)" strokeWidth="1.5" />
        {tire(14, 34, fl, 'Front left')}
        {tire(156, 34, fr, 'Front right')}
        {tire(14, 158, rl, 'Rear left')}
        {tire(156, 158, rr, 'Rear right')}
        <text x="100" y="246" textAnchor="middle" fontFamily="var(--mono)" fontSize="10" fill="var(--muted)">kPa</text>
      </svg>
    </div>
  )
}
