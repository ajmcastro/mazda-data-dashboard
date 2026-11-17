export const STEPS: Record<string, string> = {
  'Around {date} the consumption went from about {before} to about {after} ({kmBefore} before, {kmAfter} after).':
    'Por volta de {date} o consumo passou de cerca de {before} para cerca de {after} ({kmBefore} antes, {kmAfter} depois).',
  'Stretches under {km}: {before}% before, {after}% after.': 'Troços com menos de {km}: {before}% antes, {after}% depois.',
  'In the service log around then: {entries}.': 'No registo de manutenção por essa altura: {entries}.',
  '{kind} on {date}': '{kind} em {date}',
  'Too little driving to look for a change in consumption yet (at least {n} stretches and {km} on each side).':
    'Ainda há pouca condução para procurar uma mudança no consumo (são precisos pelo menos {n} troços e {km} de cada lado).',
  'No step in consumption stands out over all the data: about {level} over {km} in {n} stretches.':
    'Nenhum degrau no consumo se destaca em todos os dados: cerca de {level} em {km} e {n} troços.',
  'The consumption stepped once over all the data.': 'O consumo mudou de nível uma vez em todos os dados.',
  'The consumption stepped {n} times over all the data.': 'O consumo mudou de nível {n} vezes em todos os dados.',
  'Found in all the data: each stretch of {stretch} or more between two status reports less than two days apart, its consumption weighted by its distance, is cut where the level steps by {step} or more with at least {n} stretches and {km} on each side, and only when the step is clearly larger than the stretches’ own ups and downs. It says when, not why: the share of short stretches and the service log are shown as context.':
    'Encontrado em todos os dados: cada troço de {stretch} ou mais entre dois relatórios de estado com menos de dois dias de intervalo, com o consumo pesado pela distância, é dividido onde o nível muda {step} ou mais, com pelo menos {n} troços e {km} de cada lado, e só quando a mudança é claramente maior do que as variações normais dos troços. Diz quando, não porquê: a parte de troços curtos e o registo de manutenção aparecem como contexto.',
  'Steps in consumption': 'Degraus no consumo',
  'all the data, not just the period': 'todos os dados, não só o período',
}
