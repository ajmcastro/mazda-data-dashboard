// The English catalogue (PLAN.md M62): the source of truth for the keys. A phrase may hold {placeholders}.
// Only what has a key here is translated; everything else in the apps is still plain English.

export const en = {
  'lang.name': 'English',
  'lang.label': 'Language',
  'lang.partial': 'in progress: menus, page titles and dates',

  'nav.overview': 'Overview',
  'nav.trends': 'Trends',
  'nav.compare': 'Compare',
  'nav.alerts': 'Alerts',
  'nav.warnings': 'Warnings',
  'nav.faults': 'Faults',
  'nav.status': 'Status',
  'nav.diagnostics': 'Diagnostics',
  'nav.garage': 'All cars',
  'nav.day': 'Day',
  'nav.report': 'Report',
  'nav.reportLong': 'Report for the workshop',
  'nav.health': 'Data health',
  'nav.import': 'Import',
  'nav.more': 'More',
  'nav.data': 'Data on this phone',
  'nav.main': 'Main',
  'nav.morePages': 'More pages',

  'page.overview': 'Overview',
  'page.trends': 'Trends',
  'page.compare': 'Compare',
  'page.alerts': 'Alerts',
  'page.warnings': 'Warnings',
  'page.faults': 'Faults',
  'page.status': 'Status',
  'page.diagnostics': 'Diagnostics',
  'page.garage': 'All cars',
  'page.day': 'Day',
  'page.report': 'Report',
  'page.health': 'Data health',
  'page.import': 'Import',
  'page.more': 'More',
  'page.data': 'Data on this phone',
  'page.notFound': 'Page not found',

  'range.week': 'Last week',
  'range.fortnight': 'Last 2 weeks',
  'range.30d': 'Last 30 days',
  'range.60d': 'Last 60 days',
  'range.90d': 'Last 90 days',
  'range.all': 'All time',

  'theme.auto': 'Auto',
  'theme.dark': 'Dark',
  'theme.light': 'Light',

  'units.group': 'Units',
  'units.pressure': 'Pressure unit',
  'units.consumption': 'Fuel consumption unit',
  'units.distance': 'Distance unit',

  'common.newAlerts': '{n} new alerts',
  'common.newAlert': '1 new alert',
} as const

export type Key = keyof typeof en
