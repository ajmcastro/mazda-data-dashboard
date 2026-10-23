import { Link, NavLink, type LinkProps, type NavLinkProps } from 'react-router-dom'
import { useRangeSearch } from '../range'

/** Links that keep the selected period when moving to another page. */
export function RangeLink({ to, ...props }: Omit<LinkProps, 'to'> & { to: string }) {
  return <Link to={{ pathname: to, search: useRangeSearch() }} {...props} />
}

export function RangeNavLink({ to, ...props }: Omit<NavLinkProps, 'to'> & { to: string }) {
  return <NavLink to={{ pathname: to, search: useRangeSearch() }} {...props} />
}
