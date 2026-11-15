import { Link, NavLink, type LinkProps, type NavLinkProps } from 'react-router-dom'
import { useRangeSearch } from '../range'

/** Links that keep the selected period when moving to another page. */
export function RangeLink({ to, extra, ...props }: Omit<LinkProps, 'to'> & { to: string; extra?: Record<string, string> }) {
  const base = useRangeSearch()
  let search = base
  if (extra) {
    const p = new URLSearchParams(base)
    for (const [k, v] of Object.entries(extra)) p.set(k, v)
    search = `?${p}`
  }
  return <Link to={{ pathname: to, search }} {...props} />
}

export function RangeNavLink({ to, ...props }: Omit<NavLinkProps, 'to'> & { to: string }) {
  return <NavLink to={{ pathname: to, search: useRangeSearch() }} {...props} />
}
