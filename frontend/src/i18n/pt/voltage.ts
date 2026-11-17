export const VOLTAGE: Record<string, string> = {
  'engine running': 'motor a trabalhar',
  'engine off': 'motor desligado',
  'just after a start': 'logo após o arranque',
  'engine state unknown': 'estado do motor desconhecido',
  'No frame with the {state}.': 'Nenhum instantâneo com o {state}.',
  '{frames} on {days} from {first} to {last}': '{frames} em {days} de {first} a {last}',
  '1 frame': '1 instantâneo',
  'With the {state}: {median} in the middle, {low} to {high}; {basis}.': 'Com o {state}: {median} ao meio, de {low} a {high}; {basis}.',
  'Too few to look for a trend (it needs {frames} frames on {days} different days over {span} days).':
    'Poucos para procurar uma tendência (são precisos {frames} instantâneos em {days} dias diferentes ao longo de {span} dias).',
  'No trend can be measured.': 'Não é possível medir uma tendência.',
  'Taking the outside temperature into account, the voltage recorded with faults stayed about level.':
    'Tendo em conta a temperatura exterior, a tensão registada com as avarias manteve-se quase igual.',
  'Taking the outside temperature into account, the voltage recorded with faults moved about {rate} every 30 days.':
    'Tendo em conta a temperatura exterior, a tensão registada com as avarias variou cerca de {rate} a cada 30 dias.',
  'Around {date} it stepped from about {before} to about {after}.': 'Por volta de {date} passou de cerca de {before} para cerca de {after}.',
  'battery: the voltage recorded with faults (engine running) moved about {rate} every 30 days':
    'bateria: a tensão registada com as avarias (motor a trabalhar) variou cerca de {rate} a cada 30 dias',
  'Freeze frames are taken only when a fault is recorded, so they are not a fair sample of the car’s life. The voltage depends first on whether the engine runs (it charges the battery), so frames with the engine running and off are kept apart, and frames from the first {seconds} seconds after a start are set aside. A trend is a Theil–Sen slope of the voltage after taking the outside temperature into account; it describes the frames, not the battery’s health.':
    'Os instantâneos só são registados quando há uma avaria, por isso não são uma amostra justa da vida do carro. A tensão depende primeiro de o motor estar a trabalhar (carrega a bateria), por isso os instantâneos com o motor a trabalhar e desligado são separados, e os dos primeiros {seconds} segundos após o arranque ficam de parte. Uma tendência é um declive de Theil–Sen da tensão depois de ter em conta a temperatura exterior; descreve os instantâneos, não o estado da bateria.',
  'Battery voltage in the freeze frames': 'Tensão da bateria nos instantâneos',
  'the supply voltage recorded with faults': 'a tensão de alimentação registada com as avarias',
  'No freeze frame records a supply voltage.': 'Nenhum instantâneo regista uma tensão de alimentação.',
  'outside': 'exterior',
}
