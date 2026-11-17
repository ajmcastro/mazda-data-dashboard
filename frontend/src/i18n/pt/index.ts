// Portuguese (Portugal) for the phrases of the interface: English text -> Portuguese text. One file per area,
// merged here. A phrase used with `tr()`, `trn()` or `msg()` must have an entry (phrases.test.ts).

import { COMMON } from './common'
import { FUEL } from './fuel'
import { CAR } from './car'
import { GARAGE } from './garage'
import { IMPORTS } from './imports'
import { HEALTH } from './health'
import { ACTIVITY } from './activity'
import { FAULTS } from './faults'
import { OCCUPANCY } from './occupancy'
import { SERVICE } from './service'
import { AHEAD } from './ahead'
import { DAY } from './day'
import { TRENDS } from './trends'
import { REPORT } from './report'
import { COMPARE } from './compare'
import { COMPONENTS } from './components'
import { PAGES } from './pages'
import { PHONE } from './phone'
import { ALERTS } from './alerts'
import { EPISODES } from './episodes'
import { UNUSUAL } from './unusual'
import { STEPS } from './steps'
import { ROUTINES } from './routines'

export const PHRASES: Record<string, string> = {
  ...COMMON,
  ...ALERTS,
  ...PHONE,
  ...PAGES,
  ...COMPONENTS,
  ...COMPARE,
  ...REPORT,
  ...TRENDS,
  ...DAY,
  ...AHEAD,
  ...SERVICE,
  ...OCCUPANCY,
  ...FAULTS,
  ...ACTIVITY,
  ...HEALTH,
  ...IMPORTS,
  ...GARAGE,
  ...CAR,
  ...FUEL,
  ...EPISODES,
  ...UNUSUAL,
  ...STEPS,
  ...ROUTINES,
}
