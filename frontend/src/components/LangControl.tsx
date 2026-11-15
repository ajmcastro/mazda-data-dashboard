import { CHOICES, langName, t, useLang, useLangChoice, type LangChoice } from '../i18n'

/** The language of this device (PLAN.md M62): Auto follows the browser, or English or Portuguese (Portugal). */
export function LangControl({ className = '' }: { className?: string }) {
  const [, setLang] = useLang()
  const choice = useLangChoice()
  return (
    <div className={`units-control ${className}`}>
      <select aria-label={t('lang.label')} value={choice} onChange={(e) => setLang(e.target.value as LangChoice)}>
        {CHOICES.map((c) => (
          <option key={c} value={c}>
            {c === 'auto' ? t('lang.auto') : langName(c)}
          </option>
        ))}
      </select>
    </div>
  )
}
