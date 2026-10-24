import { THEME_LABEL, THEME_ORDER, nextTheme, useTheme, type ThemeChoice } from '../theme'

const ICON_PROPS = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

export function ThemeIcon({ choice }: { choice: ThemeChoice }) {
  if (choice === 'dark') {
    return <svg {...ICON_PROPS}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>
  }
  if (choice === 'light') {
    return (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    )
  }
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </svg>
  )
}

/** Three-way switch for wide screens: Auto follows the device, Dark and Light force a theme. */
export function ThemeToggle() {
  const [choice, setChoice] = useTheme()
  return (
    <div className="theme-toggle" role="group" aria-label="Appearance">
      {THEME_ORDER.map((c) => (
        <button key={c} type="button" aria-pressed={choice === c} onClick={() => setChoice(c)} title={`${THEME_LABEL[c]} appearance`}>
          <ThemeIcon choice={c} />
          {THEME_LABEL[c]}
        </button>
      ))}
    </div>
  )
}

/** One button for the phone's tab bar: shows the current choice, tapping goes to the next. */
export function ThemeCycleButton({ className }: { className?: string }) {
  const [choice, setChoice] = useTheme()
  const next = nextTheme(choice)
  return (
    <button
      type="button"
      className={className}
      onClick={() => setChoice(next)}
      aria-label={`Appearance: ${THEME_LABEL[choice]}. Tap for ${THEME_LABEL[next]}.`}
      title={`Appearance: ${THEME_LABEL[choice]}`}
    >
      <ThemeIcon choice={choice} />
      <span>{THEME_LABEL[choice]}</span>
    </button>
  )
}
