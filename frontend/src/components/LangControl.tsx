import { LANGS, langName, t, useLang, type Lang } from '../i18n'

/**
 * The language of this device (PLAN.md M62). Portuguese is offered as "in progress": the menus, the page titles,
 * the period presets and the dates and numbers are translated, the rest is still English.
 */
export function LangControl({ className = '' }: { className?: string }) {
  const [lang, setLang] = useLang()
  return (
    <div className={`units-control ${className}`}>
      <select aria-label={t('lang.label')} value={lang} onChange={(e) => setLang(e.target.value as Lang)} title={t('lang.partial')}>
        {LANGS.map((l) => (
          <option key={l} value={l}>
            {langName(l)}{l === 'pt' ? ` (${t('lang.partial').split(':')[0]})` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
