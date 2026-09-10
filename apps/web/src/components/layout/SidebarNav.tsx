'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAuth } from '@/components/auth/AuthProvider';
import { visibleNavItems } from '@/lib/navigation';

export function SidebarNav() {
  const pathname = usePathname();
  const { effectiveRole } = useAuth();
  const items = visibleNavItems(effectiveRole);

  return (
    <nav className="flex flex-col gap-1.5" aria-label="Main navigation">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.id}
            href={item.href}
            className={`flex items-center justify-between rounded-[14px] px-3.5 py-3 text-sm font-bold transition-colors ${
              active
                ? 'bg-white text-slate-900'
                : 'text-slate-300 hover:bg-white/10 hover:text-white'
            }`}
          >
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
