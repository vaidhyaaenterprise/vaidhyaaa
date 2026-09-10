'use client';

import { useRouter } from 'next/navigation';

import { useAuth } from '@/components/auth/AuthProvider';
import {
  clearDevAuthProfile,
} from '@/lib/dev-auth/storage';

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
      className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-red-600 shadow-sm transition-colors hover:bg-red-50"
    >
      Sign out
    </button>
  );
}
