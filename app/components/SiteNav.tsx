'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, Images, LayoutGrid } from 'lucide-react';

const LINKS = [
  { href: '/', label: 'Board', icon: LayoutGrid },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/photos', label: 'Photos', icon: Images },
];

export function SiteNav() {
  const pathname = usePathname();
  return (
    <nav className="site-nav" aria-label="Views">
      {LINKS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={pathname === href ? 'is-active' : ''}
          aria-current={pathname === href ? 'page' : undefined}
        >
          <Icon />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
