import { useState } from 'react'
import { useFlagHints, useWarningFlags } from '../api/hooks'
import type { WarningFlag, WarningFlags } from '../api/types'
import { fmtDate, fmtNum, fmtShares, lampBars, lampLabel } from '../lib'
import { Badge, Panel } from './ui'

const WINDOWS = [0.5, 2, 6, 24]

/** What happens around the times a flag is on: a hint to research from, never a meaning. */
function Hints({ flag }: { flag: string }) {
  const [hours, setHours] = useState(2)
  const hints = useFlagHints(flag, hours)
  const h = hints.data
  return (
    <div className="lamp-hints">
      <label className="muted" style={{ fontSize: 12 }}>
        Look within{' '}
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="Hours around each reading">
          {WINDOWS.map((w) => (
            <option key={w} value={w}>{w} h</option>
          ))}
        </select>{' '}
        of each reading
      </label>
      {hints.isPending && <p className="muted">Looking…</p>}
      {hints.isError && <p className="muted" role="alert">{hints.error.message}</p>}
      {h && (
        <>
          <p className="muted" style={{ fontSize: 12, margin: '6px 0' }}>
            {h.on_readings} readings with the flag on, {h.off_readings} with it off. Listed: what shows up near the
            flag more often when it is on than when it is off. <b>A hint, not a meaning</b>: things can be near each
            other by chance.
          </p>
          {h.warnings.length === 0 && h.faults.length === 0 && (
            <p className="muted">Nothing stands out at this distance.</p>
          )}
          {h.warnings.length > 0 && (
            <>
              <div className="sub-h">WARNING CODES</div>
              <ul className="hint-list">
                {h.warnings.map((w) => (
                  <li key={w.code}>
                    <span className="mono">{w.code}</span> {w.known ? w.title : <span className="muted">no description yet</span>}
                    <span className="muted"> · {fmtShares(w.share_on, w.share_off)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {h.faults.length > 0 && (
            <>
              <div className="sub-h">FAULTS</div>
              <ul className="hint-list">
                {h.faults.map((f) => (
                  <li key={`${f.ecu}${f.dtc_code}${f.failure_type}`}>
                    <span className="mono">{f.ecu} {f.dtc_code}</span> {f.title}
                    <span className="muted"> · {fmtShares(f.share_on, f.share_off)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}

function Row({ f, data }: { f: WarningFlag; data: WarningFlags }) {
  const [open, setOpen] = useState(false)
  const bars = lampBars(
    data.episodes.filter((e) => e.flag === f.flag),
    data.first_read_at,
    data.last_read_at,
  )
  return (
    <li className={`lamp-row${f.on_now ? ' on' : ''}`}>
      <button type="button" className="lamp-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="lamp-name">
          <b>{lampLabel(f)}</b>
          <span className="mono muted">{f.flag}</span>
        </span>
        <span className="lamp-badges">
          {f.on_now && <Badge kind="critical">on now</Badge>}
          {f.first_on_report_day && (
            <span title="First set on a day a diagnostic report was taken">
              <Badge kind="warning">first set on a report day</Badge>
            </span>
          )}
          {!f.title && <Badge kind="dim">no meaning yet</Badge>}
        </span>
        <span className="lamp-track" role="img" aria-label={`${f.episodes} times on`}>
          {bars.map((b, i) => (
            <i key={i} style={{ left: `${b.left}%`, width: `${b.width}%` }} />
          ))}
        </span>
        <span className="muted lamp-stat">
          on in {fmtNum(f.readings_on)} of {fmtNum(f.readings)} readings ({fmtNum(f.pct_on, 1)}%) · {f.episodes} time{f.episodes === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <div className="lamp-detail">
          <p style={{ margin: '0 0 6px' }} className="muted">
            {f.area === 'powertrain' ? 'Power train' : 'Body'} flag, bit {f.bit}. First on {fmtDate(f.first_on_at)}, last on {fmtDate(f.last_on_at)}.
            {f.notes ? ` ${f.notes}` : ''}
          </p>
          {!f.title && (
            <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
              Once you know what it is, describe it in <span className="mono">config/codes/warning_flags.yaml</span> and run{' '}
              <span className="mono">make model</span>.
            </p>
          )}
          <Hints flag={f.flag} />
        </div>
      )}
    </li>
  )
}

export function WarningLamps() {
  const flags = useWarningFlags()
  const data = flags.data
  if (!data?.has_data) return null
  return (
    <Panel title="Warning lamps" hint="the car's bit flags that ever change">
      <p className="muted" style={{ margin: '0 0 10px' }}>
        The car reports 128 on/off flags that look like the state of dashboard warning lamps. Mazda does not publish what
        they mean, and most never change, so only the {data.flags.length} that do are shown. Open one to see what happens around
        the times it is on.
      </p>
      <ul className="lamps">
        {data.flags.map((f) => (
          <Row key={f.flag} f={f} data={data} />
        ))}
      </ul>
    </Panel>
  )
}
