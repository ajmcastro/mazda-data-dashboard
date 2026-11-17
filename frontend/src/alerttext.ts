// Alert texts are written in English when the data is loaded (PLAN.md M62). Here they are put into the
// reader's language by recognising each rule's own sentence. A text that is not recognised is shown as it is.

import { msg, tr, trn } from './i18n'

type Rule = [RegExp, (m: RegExpExecArray) => string]

const WHEELS = [msg('front left'), msg('front right'), msg('rear left'), msg('rear right')]
const AREAS = [msg('powertrain'), msg('body')]
const OPEN = [msg('driver door'), msg('passenger door'), msg('rear left door'), msg('rear right door'), msg('trunk'), msg('hood'), msg('hazard lights')]
/** "driver door, hazard lights" as the detector lists open parts, each part translated. */
const openList = (text: string): string => text.split(', ').map((p) => word(p, OPEN)).join(', ')
const UNUSUAL_END = msg(" Unlike this car's other reports; a hint, not a diagnosis.")
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A word the detectors choose from a short list (a wheel, an area): translated when it is one of them. */
const word = (text: string, list: string[]): string => (list.includes(text) ? tr(text) : text)
/** "2026-06-27 14:05 UTC" stays as written; only the words for a missing value are translated. */
const when = (text: string): string => (text === 'unknown time' ? tr('unknown time') : text)
const km = (text: string): string => (text === 'unknown odometer' ? tr('unknown odometer') : text)
const raw = (text: string): string => (text === 'unknown' ? tr('unknown') : text)

const NO_DTC_TITLE = " No description yet: add one in the model's codes/dtcs.yaml (config/models/<id>/)."
const FLAG_REPORT_DAY = ' That is a day a diagnostic report was taken.'
const FLAG_UNDESCRIBED =
  " Mazda does not publish what it means: Status > Warning lamps shows what happens around it, and the model's codes/warning_flags.yaml (config/models/<id>/) is where to describe it."

// One entry per sentence the detectors write (backend alerts/detectors.py): keep the two in step.
const TITLES: Rule[] = [
  [/^New fault (\S+) on (.+)$/, (m) => tr('New fault {code} on {unit}', { code: m[1], unit: m[2] })],
  [/^Recurring fault (\S+) on (.+)$/, (m) => tr('Recurring fault {code} on {unit}', { code: m[1], unit: m[2] })],
  [/^New warning code (.+)$/, (m) => tr('New warning code {code}', { code: m[1] })],
  [/^Warning (\S+) spiked on (.+)$/, (m) => tr('Warning {code} spiked on {day}', { code: m[1], day: m[2] })],
  [/^Burglar alarm status raised$/, () => tr('Burglar alarm status raised')],
  [/^High fuel consumption: (.+)$/, (m) => tr('High fuel consumption: {value}', { value: m[1] })],
  [/^Low fuel: (.+)$/, (m) => tr('Low fuel: {value}', { value: m[1] })],
  [
    /^Unusual report: the fuel level fell (\S+) points while parked$/,
    (m) => tr('Unusual report: the fuel level fell {n} points while parked', { n: m[1] }),
  ],
  [/^Unusual report: tire pressures (\S+ \S+) apart$/, (m) => tr('Unusual report: tire pressures {spread} apart', { spread: m[1] })],
  [/^Unusual report at (\S+) \(car's local time\)$/, (m) => tr("Unusual report at {time} (car's local time)", { time: m[1] })],
  [/^Unusual report: (.+) open$/, (m) => tr('Unusual report: {parts} open', { parts: openList(m[1]) })],
  [
    /^Tire losing pressure \((.+)\): about (\S+) days to the limit$/,
    (m) => tr('Tire losing pressure ({wheel}): about {days} days to the limit', { wheel: word(m[1], WHEELS), days: m[2] }),
  ],
  [/^Low tire pressure \((.+)\): (.+)$/, (m) => tr('Low tire pressure ({wheel}): {value}', { wheel: word(m[1], WHEELS), value: m[2] })],
  [
    /^Low voltage in a fault's freeze frame \((.+)\): (.+)$/,
    (m) => tr("Low voltage in a fault's freeze frame ({fault}): {value}", { fault: m[1], value: m[2] }),
  ],
  [/^No new data for (\S+) days$/, (m) => tr('No new data for {days} days', { days: m[1] })],
  [/^Oil change in about (\S+) days at your recent pace$/, (m) => tr('Oil change in about {days} days at your recent pace', { days: m[1] })],
  [/^Oil change due soon: about (.+) left$/, (m) => tr('Oil change due soon: about {distance} left', { distance: m[1] })],
  [/^The car reports a warning: (.+)$/, (m) => tr('The car reports a warning: {label}', { label: tr(m[1]) })],
  [
    /^New warning-lamp flag set: (.+)$/,
    (m) => {
      const bit = /^(powertrain|body) bit (\d+)$/.exec(m[1])
      return tr('New warning-lamp flag set: {what}', { what: bit ? tr('{area} bit {bit}', { area: word(bit[1], AREAS), bit: bit[2] }) : m[1] })
    },
  ],
]

const DETAILS: Rule[] = [
  [
    /^(.+)\. First reported (.+?) at (.+?)\.( No description yet: .+)?$/,
    (m) =>
      tr('{title}. First reported {when} at {distance}.', { title: codeTitle(m[1]), when: when(m[2]), distance: km(m[3]) }) +
      (m[4] === NO_DTC_TITLE ? ` ${tr("No description yet: add one in the model's codes/dtcs.yaml (config/models/<id>/).")}` : (m[4] ?? '')),
  ],
  [
    /^(.+)\. Listed in (\d+) read-outs since (.+?); still present in the latest one\.$/,
    (m) => tr('{title}. Listed in {n} read-outs since {when}; still present in the latest one.', { title: codeTitle(m[1]), n: m[2], when: when(m[3]) }),
  ],
  [
    /^(.+)\. First seen (.+?); (\d+) event\(s\) so far\.$/,
    (m) => tr('{title}. First seen {when}; {n} event(s) so far.', { title: codeTitle(m[1]), when: when(m[2]), n: m[3] }),
  ],
  [
    /^(\d+) events in one day \(usual: (.+?)\/day\)\. (.+)\.$/,
    (m) => tr('{n} events in one day (usual: {mean}/day). {title}.', { n: m[1], mean: m[2], title: codeTitle(m[3]) }),
  ],
  [
    /^At (.+?) the alarm reported status (\S+), reason (\S+)\. Check whether this was you \(door lock, key fob, tow\)\.$/,
    (m) =>
      tr('At {when} the alarm reported status {status}, reason {reason}. Check whether this was you (door lock, key fob, tow).', {
        when: when(m[1]), status: raw(m[2]), reason: raw(m[3]),
      }),
  ],
  [
    /^(\S+ km) ending (.+?) used (\S+ l), (\S+)x your average of (.+)\.$/,
    (m) => tr('{distance} ending {when} used {fuel}, {times}x your average of {average}.', { distance: m[1], when: when(m[2]), fuel: m[3], times: m[4], average: m[5] }),
  ],
  [
    /^Fuel gauge at (\S+) on (.+?), range about (.+)\.$/,
    (m) => tr('Fuel gauge at {pct} on {when}, range about {distance}.', { pct: m[1], when: when(m[2]), distance: m[3] }),
  ],
  [/^Fuel gauge at (\S+) on (.+)\.$/, (m) => tr('Fuel gauge at {pct} on {when}.', { pct: m[1], when: when(m[2]) })],
  [
    /^The (.+) tire is losing about (.+?) a week against the other three\. At this rate it reaches your (.+?) limit around (\S+) \(it read (.+?); based on (\d+) measurements over (\S+) days\)\.$/,
    (m) =>
      tr('The {wheel} tire is losing about {rate} a week against the other three. At this rate it reaches your {limit} limit around {day} (it read {now}; based on {n} measurements over {days} days).', {
        wheel: word(m[1], WHEELS), rate: m[2], limit: m[3], day: m[4], now: m[5], n: m[6], days: m[7],
      }),
  ],
  [
    new RegExp(`^At (.+?) \\(car's local time\\) the fuel level was (\\S+) points lower than in the report before while the odometer did not move; usually it falls by (\\S+) to (\\S+) points\\.${esc(UNUSUAL_END)}$`),
    (m) =>
      tr("At {when} (car's local time) the fuel level was {n} points lower than in the report before while the odometer did not move; usually it falls by {low} to {high} points.", { when: m[1], n: m[2], low: m[3], high: m[4] }) + tr(UNUSUAL_END),
  ],
  [
    new RegExp(`^At (.+?) \\(car's local time\\) the highest and lowest tire pressures were (\\S+ \\S+) apart; usually (\\S+) to (\\S+ \\S+)\\.${esc(UNUSUAL_END)}$`),
    (m) =>
      tr("At {when} (car's local time) the highest and lowest tire pressures were {spread} apart; usually {low} to {high}.", { when: m[1], spread: m[2], low: m[3], high: m[4] }) + tr(UNUSUAL_END),
  ],
  [
    new RegExp(`^The car sent a report at (.+?) \\(car's local time\\), an hour with (\\S+)% of its (status|door) reports\\.${esc(UNUSUAL_END)}$`),
    (m) =>
      (m[3] === 'status'
        ? tr("The car sent a report at {when} (car's local time), an hour with {pct}% of its status reports.", { when: m[1], pct: m[2] })
        : tr("The car sent a report at {when} (car's local time), an hour with {pct}% of its door reports.", { when: m[1], pct: m[2] })) + tr(UNUSUAL_END),
  ],
  [
    new RegExp(`^At (.+?) \\(car's local time\\) the car reported (.+) open, as in (\\S+)% of its door reports\\.${esc(UNUSUAL_END)}$`),
    (m) =>
      tr("At {when} (car's local time) the car reported {parts} open, as in {pct}% of its door reports.", { when: m[1], parts: openList(m[2]), pct: m[3] }) + tr(UNUSUAL_END),
  ],
  [
    /^The (.+) tire read (.+?) on (\S+), below your (.+?) limit\.$/,
    (m) => tr('The {wheel} tire read {value} on {day}, below your {limit} limit.', { wheel: word(m[1], WHEELS), value: m[2], day: m[3], limit: m[4] }),
  ],
  [
    /^The freeze frame of fault (.+) recorded (.+?) \((.+)\), below your (.+?) limit\. Worth a look at the battery; a hint, not a diagnosis\.$/,
    (m) =>
      tr('The freeze frame of fault {fault} recorded {value} ({signal}), below your {limit} limit. Worth a look at the battery; a hint, not a diagnosis.', {
        fault: m[1], value: m[2], signal: m[3], limit: m[4],
      }),
  ],
  [
    /^The latest data point is from (.+?)\. Request a new export from Mazda and run `make ingest`\.$/,
    (m) => tr('The latest data point is from {when}. Request a new export from Mazda and run `make ingest`.', { when: when(m[1]) }),
  ],
  [
    /^About (.+?) are left on the car's countdown\. At the pace of the last 30 and 90 days that is between (\S+) and (\S+), counted from (\S+)\. The countdown moves in steps of 1,000 km or more\.$/,
    (m) =>
      tr("About {distance} are left on the car's countdown. At the pace of the last 30 and 90 days that is between {first} and {last}, counted from {from}. The countdown moves in steps of 1,000 km or more.", {
        distance: m[1], first: m[2], last: m[3], from: m[4],
      }),
  ],
  [
    /^The car reported (.+?) until the next oil change on (.+? UTC|unknown time)(?: \(odometer (.+?)\))?\. It counts in steps of 1,000 km or more, so the real distance can be less\.$/,
    (m) =>
      tr('The car reported {distance} until the next oil change on {when}', { distance: m[1], when: when(m[2]) }) +
      (m[3] ? ` ${tr('(odometer {distance})', { distance: m[3] })}` : '') +
      `. ${tr('It counts in steps of 1,000 km or more, so the real distance can be less.')}`,
  ],
  [
    /^The car's own warning flag \((.+?)\) was on (since (.+?)|from (.+?) to (.+?)) \((\d+) readings?, raw value (\S+)\)\. This is the car's flag, not a calculation by this app, and Mazda does not publish what the values mean\.$/,
    (m) =>
      tr("The car's own warning flag ({flag}) was on {span} ({readings}, raw value {value}). This is the car's flag, not a calculation by this app, and Mazda does not publish what the values mean.", {
        flag: m[1],
        span: m[3] ? tr('since {when}', { when: when(m[3]) }) : tr('from {from} to {to}', { from: when(m[4]), to: when(m[5]) }),
        readings: trn('{n} reading', '{n} readings', Number(m[6])),
        value: raw(m[7]),
      }),
  ],
  [
    /^The flag (\S+) \((powertrain|body), bit (\d+)\) was set for the first time on (.+?); so far it was on in (\d+) of (\d+) readings\.(.*)$/,
    (m) => {
      let rest = m[7]
      let more = ''
      if (rest.startsWith(FLAG_REPORT_DAY)) {
        more += ` ${tr('That is a day a diagnostic report was taken.')}`
        rest = rest.slice(FLAG_REPORT_DAY.length)
      }
      if (rest === FLAG_UNDESCRIBED) {
        more += ` ${tr("Mazda does not publish what it means: Status > Warning lamps shows what happens around it, and the model's codes/warning_flags.yaml (config/models/<id>/) is where to describe it.")}`
        rest = ''
      }
      return (
        tr('The flag {flag} ({area}, bit {bit}) was set for the first time on {when}; so far it was on in {on} of {n} readings.', {
          flag: m[1], area: word(m[2], AREAS), bit: m[3], when: when(m[4]), on: m[5], n: m[6],
        }) + more + rest
      )
    },
  ],
]

function put(text: string, rules: Rule[]): string {
  for (const [pattern, say] of rules) {
    const m = pattern.exec(text)
    if (m) return say(m)
  }
  return text
}

/** An alert's title in the reader's language. */
export const alertTitle = (title: string): string => put(title, TITLES)

/** An alert's detail in the reader's language. */
export const alertDetail = (detail: string): string => put(detail, DETAILS)

/** What each rule is called under an alert: the rule's name in words (a test reads the detectors for the list). */
export const RULE_NAMES: Record<string, string> = {
  new_dtc: msg('new fault'), recurring_dtc: msg('recurring fault'), new_warning_code: msg('new warning code'),
  warning_spike: msg('warning spike'), burglar_alarm: msg('burglar alarm'), high_consumption: msg('high consumption'),
  low_fuel: msg('low fuel'), low_tire_pressure: msg('low tire pressure'), tire_leak_forecast: msg('tire leak forecast'),
  low_battery_frame: msg('low voltage in a freeze frame'), data_gap: msg('no new data'), oil_change_due: msg('oil change due'),
  car_warning_flag: msg('car warning flag'), new_warning_flag: msg('new warning-lamp flag'), unusual_report: msg('unusual report'),
}
/** A rule nobody named yet is shown by its own name, as before. */
export const ruleName = (rule: string): string => (rule in RULE_NAMES ? tr(RULE_NAMES[rule]) : rule.replaceAll('_', ' '))

/** The names the car's own warning flags get in `views.sql` (v_car_warning_readings), so they can be translated. */
export const CAR_WARNING_LABELS = [
  msg('tire pressure, front left'), msg('tire pressure, front right'), msg('tire pressure, rear left'), msg('tire pressure, rear right'),
  msg('tire pressure system status'), msg('tire pressure system fault'), msg('oil level'), msg('seat belt reminder'), msg('door open'),
]

/** A code's title as the views give it: the owner's description stays as written; "Unknown warning $201" is translated. */
export function codeTitle(title: string): string {
  const m = /^Unknown (warning|DTC) (.+)$/.exec(title)
  if (!m) return title === 'no description yet' ? tr('no description yet') : title
  return m[1] === 'DTC' ? tr('Unknown DTC {code}', { code: m[2] }) : tr('Unknown warning {code}', { code: m[2] })
}
