'use client';

import { useRouter } from 'next/navigation';

import { useAuth } from '@/components/auth/AuthProvider';
import { clearDevAuthProfile } from '@/lib/dev-auth/storage';

export function DevAuthSwitcher() {
  const router = useRouter();
  const { refresh } = useAuth();

  async function logout() {
    clearDevAuthProfile();
    await refresh();
    router.push('/login');
  }

  return (
    <button
      type="button"
      onClick={logout}
      className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-red-300/25 bg-red-500/10 px-4 py-2 text-sm font-bold text-red-200 transition-colors hover:bg-red-500/20 max-lg:border-red-200 max-lg:bg-red-50 max-lg:text-red-600 max-lg:hover:bg-red-100"
    >
      Sign out
    </button>
  );
}
