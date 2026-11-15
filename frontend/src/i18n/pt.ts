// The Portuguese catalogue (Portugal): the same keys as en.ts, checked by the type, so a missing phrase does
// not compile. Portuguese of Portugal: "ecrã", "definições", "avaria", not the Brazilian forms.

import type { Key } from './en'

export const pt: Record<Key, string> = {
  'lang.name': 'Português',
  'lang.label': 'Idioma',
  'lang.partial': 'em curso: menus, títulos das páginas e datas',

  'nav.overview': 'Resumo',
  'nav.trends': 'Tendências',
  'nav.compare': 'Comparar',
  'nav.alerts': 'Alertas',
  'nav.warnings': 'Avisos',
  'nav.faults': 'Avarias',
  'nav.status': 'Estado',
  'nav.diagnostics': 'Diagnóstico',
  'nav.garage': 'Todos os carros',
  'nav.day': 'Dia',
  'nav.report': 'Relatório',
  'nav.reportLong': 'Relatório para a oficina',
  'nav.health': 'Estado dos dados',
  'nav.import': 'Importar',
  'nav.more': 'Mais',
  'nav.data': 'Dados neste telemóvel',
  'nav.main': 'Principal',
  'nav.morePages': 'Mais páginas',

  'page.overview': 'Resumo',
  'page.trends': 'Tendências',
  'page.compare': 'Comparar',
  'page.alerts': 'Alertas',
  'page.warnings': 'Avisos',
  'page.faults': 'Avarias',
  'page.status': 'Estado',
  'page.diagnostics': 'Diagnóstico',
  'page.garage': 'Todos os carros',
  'page.day': 'Dia',
  'page.report': 'Relatório',
  'page.health': 'Estado dos dados',
  'page.import': 'Importar',
  'page.more': 'Mais',
  'page.data': 'Dados neste telemóvel',
  'page.notFound': 'Página não encontrada',

  'range.week': 'Última semana',
  'range.fortnight': 'Últimas 2 semanas',
  'range.30d': 'Últimos 30 dias',
  'range.60d': 'Últimos 60 dias',
  'range.90d': 'Últimos 90 dias',
  'range.all': 'Tudo',

  'theme.auto': 'Auto',
  'theme.dark': 'Escuro',
  'theme.light': 'Claro',

  'units.group': 'Unidades',
  'units.pressure': 'Unidade de pressão',
  'units.consumption': 'Unidade de consumo',
  'units.distance': 'Unidade de distância',

  'common.newAlerts': '{n} alertas novos',
  'common.newAlert': '1 alerta novo',
}
