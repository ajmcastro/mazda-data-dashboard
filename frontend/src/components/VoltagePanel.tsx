// The supply voltage recorded with faults (PLAN.md M68), by engine state. Wording in `voltage.ts`: the frames,
// never the battery's health. Colours are neutral: they tell the engine states apart, not good from bad.
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import { tr } from '../i18n'
import { useFrameVoltage } from '../api/hooks'
import { ANIMATE, fmtDateTime, fmtNum, fmtTick } from '../lib'
import { STATE_LABEL, VOLTAGE_NOTE, groupLine } from '../voltage'
import { Panel, QueryState } from './ui'

const axis = { stroke: 'var(--muted)', fontSize: 11, fontFamily: 'var(--mono)' }
const COLOUR: Record<string, string> = { running: 'var(--teal)', off: 'var(--steel)', starting: 'var(--muted)', unknown: 'var(--muted)' }

export function VoltagePanel() {
  const query = useFrameVoltage()
  const f = query.data
  const states = ['running', 'off', 'starting', 'unknown'].filter((s) => f?.frames.some((x) => x.state === s))
  return (
    <Panel title={tr('Battery voltage in the freeze frames')} hint={tr('the supply voltage recorded with faults')}>
      <QueryState query={query}>
        {!f?.frames.length ? (
          <p className="muted">{tr('No freeze frame records a supply voltage.')}</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <ScatterChart margin={{ right: 18, top: 5 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtTick} minTickGap={36} {...axis} />
                <YAxis dataKey="v" type="number" domain={['auto', 'auto']} width={40} tickFormatter={(v: number) => fmtNum(v, 1)} {...axis} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload as { t: number; v: number; s: string; a: number | null }
                    return (
                      <div className="chart-tip">
                        <div className="t">{fmtDateTime(new Date(d.t).toISOString())}</div>
                        <div className="row"><span>{tr(STATE_LABEL[d.s] ?? d.s)}</span><span>{fmtNum(d.v, 2)} V</span></div>
                        {d.a !== null && <div className="row"><span>{tr('outside')}</span><span>{fmtNum(d.a, 0)} °C</span></div>}
                      </div>
                    )
                  }}
                />
                {states.map((s) => (
                  <Scatter
                    key={s}
                    name={tr(STATE_LABEL[s])}
                    isAnimationActive={ANIMATE}
                    fill={COLOUR[s]}
                    data={f.frames.filter((x) => x.state === s).map((x) => ({ t: Date.parse(x.at), v: x.voltage, s, a: x.ambient ?? null }))}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
            <div className="chips" style={{ marginTop: 6 }}>
              {states.map((s) => (
                <span key={s} className="chip" style={{ borderColor: COLOUR[s] }}>{tr(STATE_LABEL[s])}</span>
              ))}
            </div>
            {f.groups.map((g) => (
              <p key={g.state}>{groupLine(g, f)}</p>
            ))}
          </>
        )}
        <p className="muted note">{tr(VOLTAGE_NOTE, { seconds: f?.starting_seconds ?? 60 })}</p>
      </QueryState>
    </Panel>
  )
}
