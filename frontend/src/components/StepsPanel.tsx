// Where the consumption stepped up or down (PLAN.md M65), over all the data. Wording in `steps.ts`: when,
// never why; the short stretches and the service log are context.
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { tr } from '../i18n'
import { useChangePoints, useServiceLog } from '../api/hooks'
import { ANIMATE, fmtDate, fmtTick } from '../lib'
import { STEPS_NOTE, mixLine, serviceLine, stepLine, steps, summaryLine } from '../steps'
import { consumptionLabel, distanceText, fmtConsumption, toConsumption } from '../units'
import { Panel, QueryState } from './ui'

const axis = { stroke: 'var(--muted)', fontSize: 11, fontFamily: 'var(--mono)' }

export function StepsPanel() {
  const query = useChangePoints()
  const service = useServiceLog()
  const cp = query.data
  const found = steps(cp)
  const data = (cp?.segments ?? []).flatMap((s) => [
    { t: Date.parse(s.from_at), v: toConsumption(s.l_per_100km) },
    { t: Date.parse(s.to_at), v: toConsumption(s.l_per_100km) },
  ])
  return (
    <Panel title={tr('Steps in consumption')} hint={tr('all the data, not just the period')}>
      <QueryState query={query}>
        <p style={{ marginTop: 0 }}>{summaryLine(cp)}</p>
        {found.length > 0 && (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={data} margin={{ right: 18, top: 5 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(t: number) => fmtTick(t)} minTickGap={40} {...axis} />
              <YAxis domain={['auto', 'auto']} hide />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload as { t: number; v: number }
                  return (
                    <div className="chart-tip">
                      <div className="t">{fmtDate(new Date(d.t).toISOString())}</div>
                      <div className="row"><span>{consumptionLabel()}</span><span>{d.v.toFixed(1)}</span></div>
                    </div>
                  )
                }}
              />
              {found.map((s) => (
                <ReferenceLine key={s.at} x={Date.parse(s.at)} stroke="var(--muted)" strokeDasharray="4 3" />
              ))}
              <Line type="linear" dataKey="v" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={ANIMATE} />
            </LineChart>
          </ResponsiveContainer>
        )}
        {found.length > 0 && (
          <ul className="steps-list">
            {found.map((s) => (
              <li key={s.at}>
                <span>{stepLine(s)}</span>
                {[mixLine(s, cp!.stretch_km), serviceLine(s, service.data?.entries)].filter(Boolean).map((line) => (
                  <span key={line} className="muted">{line}</span>
                ))}
              </li>
            ))}
          </ul>
        )}
        {cp && (
          <p className="muted note">
            {tr(STEPS_NOTE, {
              stretch: distanceText(cp.stretch_km),
              step: `${fmtConsumption(cp.min_step)} ${consumptionLabel()}`,
              n: cp.min_stretches,
              km: distanceText(cp.min_km),
            })}
          </p>
        )}
      </QueryState>
    </Panel>
  )
}
