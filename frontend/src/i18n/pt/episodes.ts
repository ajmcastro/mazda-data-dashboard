export const EPISODES: Record<string, string> = {
  '1 day': '1 dia',
  'about 1 minute': 'cerca de 1 minuto',
  'about {n} minutes': 'cerca de {n} minutos',
  '1 episode': '1 episódio',
  '{n} episodes': '{n} episódios',
  '{episodes} on {days}, usually {length}': '{episodes} em {days}, em regra {length}',
  '({n} in all the data)': '({n} em todos os dados)',
  '1 episode of warnings': '1 episódio de avisos',
  '{n} episodes of warnings': '{n} episódios de avisos',
  '{episodes} in the period': '{episodes} no período',
  '1 recurring pattern holds {held} of them': '1 padrão recorrente reúne {held} deles',
  '{n} recurring patterns hold {held} of them': '{n} padrões recorrentes reúnem {held} deles',
  '{list} is in nearly every episode, so it is left out when comparing them.':
    '{list} aparece em quase todos os episódios, por isso fica de fora quando se comparam.',
  '{list} are in nearly every episode, so they are left out when comparing them.':
    '{list} aparecem em quase todos os episódios, por isso ficam de fora quando se comparam.',
  '1 episode is unlike the others and seen fewer than {min} times in all the data; it is not listed.':
    '1 episódio é diferente dos outros e foi visto menos de {min} vezes em todos os dados; não aparece na lista.',
  '{n} episodes are in groups seen fewer than {min} times in all the data; they are not listed.':
    '{n} episódios pertencem a grupos vistos menos de {min} vezes em todos os dados; não aparecem na lista.',
  'within a day of': 'a menos de um dia de',
  'within {h} hours of': 'a menos de {h} horas de',
  'read out {when} {n} of these {total} episodes ({all}% of all episodes in the period)': 'lida {when} {n} destes {total} episódios ({all}% de todos os episódios do período)',
  'usually with {codes}': 'em regra com {codes}',
  'An episode is a run of warnings with no silence longer than {gap} minutes. Patterns are learned from all the data: episodes whose codes are alike are grouped around the sets of codes that recur most. A pattern shows which codes turn up together, not what they mean or why. A fault is listed next to a pattern only when it was read out near at least 3 of its episodes and near a clearly larger share of them than of all episodes; that is all it says.':
    'Um episódio é uma sequência de avisos sem silêncio superior a {gap} minutos. Os padrões são aprendidos com todos os dados: os episódios com códigos parecidos são agrupados à volta dos conjuntos de códigos que mais se repetem. Um padrão mostra que códigos surgem juntos, não o que significam nem a razão. Uma avaria só aparece ao lado de um padrão quando foi lida perto de pelo menos 3 dos seus episódios e perto de uma parte deles claramente maior do que a de todos os episódios; é tudo o que isso diz.',
  'Patterns': 'Padrões',
  'which warning codes usually turn up together': 'que códigos de aviso surgem juntos com frequência',
  'Pattern {n}': 'Padrão {n}',
  'always': 'sempre',
  'sometimes': 'às vezes',
  '+{n} rarer': '+{n} mais raros',
  'only codes that are in nearly every episode': 'só códigos que aparecem em quase todos os episódios',
  'Faults read out nearby': 'Avarias lidas perto',
  'No warnings in this period.': 'Sem avisos neste período.',
}
