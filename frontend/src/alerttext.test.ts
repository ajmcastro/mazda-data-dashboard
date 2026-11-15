import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { RULE_NAMES, alertDetail, alertTitle, codeTitle, ruleName } from './alerttext'
import { setLang } from './i18n'

afterEach(() => setLang('en'))

// What each rule writes (backend alerts/detectors.py), in every variant it has: [title, detail].
const SAMPLES: Record<string, [string, string][]> = {
  new_dtc: [
    ['New fault C1B22:87 on ADU', "Unknown DTC C1B22. First reported 2026-06-25 07:24 UTC at 4,740 km. No description yet: add one in the model's codes/dtcs.yaml (config/models/<id>/)."],
    ['New fault U0198:00 on BCM', 'Lost communication. With the telematics unit. First reported unknown time at unknown odometer.'],
  ],
  recurring_dtc: [['Recurring fault U0198:00 on BCM', 'Lost communication with telematics control module. Listed in 15 read-outs since 2026-03-19 08:40 UTC; still present in the latest one.']],
  new_warning_code: [['New warning code $4E9', 'Unknown warning $4E9. First seen 2026-06-29 17:52 UTC; 3 event(s) so far.']],
  warning_spike: [['Warning $1C4 spiked on 2026-06-12', '48 events in one day (usual: 1.1/day). Unknown warning $1C4.']],
  burglar_alarm: [
    ['Burglar alarm status raised', 'At 2026-06-22 21:19 UTC the alarm reported status 5, reason unknown. Check whether this was you (door lock, key fob, tow).'],
  ],
  high_consumption: [['High fuel consumption: 13.4 l/100 km', '60 km ending 2026-06-06 15:44 UTC used 8.0 l, 1.9x your average of 7.0 l/100 km.']],
  low_fuel: [
    ['Low fuel: 8%', 'Fuel gauge at 8% on 2026-06-06 15:44 UTC, range about 45 km.'],
    ['Low fuel: 8%', 'Fuel gauge at 8% on 2026-06-06 15:44 UTC.'],
  ],
  low_tire_pressure: [['Low tire pressure (rear left): 190 kPa', 'The rear left tire read 190 kPa on 2026-06-26, below your 200 kPa limit.']],
  tire_leak_forecast: [
    [
      'Tire losing pressure (front left): about 9 days to the limit',
      'The front left tire is losing about 7.5 kPa a week against the other three. At this rate it reaches your 200 kPa limit around 2026-08-09 (it read 215 kPa; based on 12 measurements over 21.5 days).',
    ],
  ],
  low_battery_frame: [
    [
      "Low voltage in a fault's freeze frame (BCM U0198): 11.4 V",
      'The freeze frame of fault BCM U0198 recorded 11.4 V (Battery_Voltage), below your 12 V limit. Worth a look at the battery; a hint, not a diagnosis.',
    ],
  ],
  data_gap: [['No new data for 133 days', 'The latest data point is from 2026-06-30 18:01 UTC. Request a new export from Mazda and run `make ingest`.']],
  oil_change_due: [
    [
      'Oil change due soon: about 1,000 km left',
      'The car reported 1,000 km until the next oil change on 2026-06-30 18:01 UTC (odometer 4,879 km). It counts in steps of 1,000 km or more, so the real distance can be less.',
    ],
    ['Oil change due soon: about 1,000 km left', 'The car reported 1,000 km until the next oil change on 2026-06-30 18:01 UTC. It counts in steps of 1,000 km or more, so the real distance can be less.'],
    [
      'Oil change in about 20 days at your recent pace',
      "About 1,000 km are left on the car's countdown. At the pace of the last 30 and 90 days that is between 2026-07-20 and 2026-08-02, counted from 2026-06-30. The countdown moves in steps of 1,000 km or more.",
    ],
  ],
  car_warning_flag: [
    [
      'The car reports a warning: tire pressure, rear left',
      "The car's own warning flag (rltyrepresswarn) was on since 2026-06-20 11:21 UTC (14 readings, raw value 1). This is the car's flag, not a calculation by this app, and Mazda does not publish what the values mean.",
    ],
    [
      'The car reports a warning: oil level',
      "The car's own warning flag (oillevelwarning) was on from 2026-06-20 11:21 UTC to 2026-06-21 09:00 UTC (1 reading, raw value 2). This is the car's flag, not a calculation by this app, and Mazda does not publish what the values mean.",
    ],
  ],
  new_warning_flag: [
    [
      'New warning-lamp flag set: body bit 44',
      "The flag vdt_7_warningbody_2_44 (body, bit 44) was set for the first time on 2026-06-29 07:28 UTC; so far it was on in 4 of 195 readings. That is a day a diagnostic report was taken. Mazda does not publish what it means: Status > Warning lamps shows what happens around it, and the model's codes/warning_flags.yaml (config/models/<id>/) is where to describe it.",
    ],
    ['New warning-lamp flag set: Glow plug lamp', 'The flag vdt_2_warningpt_1_3 (powertrain, bit 3) was set for the first time on 2026-06-29 07:28 UTC; so far it was on in 4 of 195 readings.'],
  ],
}

const all = Object.values(SAMPLES).flat()
// words that only an untranslated sentence would still hold
const ENGLISH = /\b(the|was|is|are|your|about|since|until|below|reported|reason|events?|readings?|left|days|fault|flag|tire|warning|limit|unknown)\b/i

describe('alert texts', () => {
  it('have a sample for every rule the detectors define', () => {
    const source = readFileSync(new URL('../../backend/src/mazda_dash/alerts/detectors.py', import.meta.url), 'utf8')
    const registry = source.slice(source.indexOf('DETECTORS:'))
    const rules = [...registry.matchAll(/^ {4}"(\w+)":/gm)].map((m) => m[1])
    expect(rules.length).toBeGreaterThan(10)
    expect(Object.keys(SAMPLES).sort()).toEqual([...rules].sort())
    expect(Object.keys(RULE_NAMES).sort()).toEqual([...rules].sort())
    expect(ruleName('new_dtc')).toBe('new fault')
    expect(ruleName('a_later_rule')).toBe('a later rule')
  })

  it('are recognised: in English every sentence comes back exactly as the detector wrote it', () => {
    for (const [title, detail] of all) {
      expect(alertTitle(title)).toBe(title)
      expect(alertDetail(detail)).toBe(detail)
    }
  })

  it('are put into Portuguese whole, with nothing English left but the names and codes', () => {
    setLang('pt')
    // what stays as written: an owner's description, a code, a signal name, a file path, a command
    const kept = /Lost communication[^.]*\.( With the telematics unit\.)?|Glow plug lamp|Battery_Voltage|vdt_\w+|\w+warn\w*|codes\/\w+\.yaml|config\/models\/<id>\/|`make ingest`|\$\w+|\b[A-Z]\w*\d\w*(:\w+)?\b|UTC/g
    for (const [title, detail] of all) {
      for (const [english, portuguese] of [[title, alertTitle(title)], [detail, alertDetail(detail)]]) {
        expect(portuguese).not.toBe(english)
        expect(portuguese).not.toMatch(/\{\w+\}/)
        expect(portuguese.replace(kept, '')).not.toMatch(ENGLISH)
      }
    }
  })

  it('say the same thing in Portuguese (two sentences pinned)', () => {
    setLang('pt')
    expect(alertTitle('Low tire pressure (rear left): 190 kPa')).toBe('Pressão baixa no pneu (roda traseira esquerda): 190 kPa')
    expect(alertDetail('The rear left tire read 190 kPa on 2026-06-26, below your 200 kPa limit.')).toBe(
      'O pneu da roda traseira esquerda marcou 190 kPa em 2026-06-26, abaixo do seu limite de 200 kPa.',
    )
    expect(alertDetail('Unknown warning $4E9. First seen 2026-06-29 17:52 UTC; 3 event(s) so far.')).toBe(
      'Aviso $4E9 desconhecido. Visto pela primeira vez em 2026-06-29 17:52 UTC; 3 evento(s) até agora.',
    )
  })

  it('leave a text they do not know as it came', () => {
    setLang('pt')
    expect(alertTitle('Something a later version writes')).toBe('Something a later version writes')
    expect(alertDetail('Another sentence nobody listed.')).toBe('Another sentence nobody listed.')
  })

  it('translate the placeholder title of a code nobody described, and keep a described one', () => {
    setLang('pt')
    expect(codeTitle('Unknown DTC U0198')).toBe('DTC U0198 desconhecido')
    expect(codeTitle('Lost communication')).toBe('Lost communication')
  })
})
