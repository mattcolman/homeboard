'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, Images, LayoutGrid, Sparkles } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

const LINKS = [
  { href: '/', label: 'Board', icon: LayoutGrid },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/artifacts', label: 'Artifacts', icon: Sparkles },
  { href: '/photos', label: 'Photos', icon: Images },
];

export function SiteNav() {
  const pathname = usePathname();
  return (
    <nav className="site-nav" aria-label="Views">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active =
          href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={active ? 'is-active' : ''}
            aria-current={active ? 'page' : undefined}
            aria-label={label}
            title={label}
          >
            <Icon />
          </Link>
        );
      })}
      <span className="site-nav-divider" aria-hidden="true" />
      <ThemeToggle />
    </nav>
  );
}
