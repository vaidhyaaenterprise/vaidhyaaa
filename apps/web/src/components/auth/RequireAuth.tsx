'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { canAccessRoute } from '@/lib/navigation';

type RequireAuthProps = {
  pathname: string;
  children: ReactNode;
};

export function RequireAuth({ pathname, children }: RequireAuthProps) {
  const router = useRouter();
  const { status, effectiveRole, error, errorCode } = useAuth();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (status === 'authenticated' && !canAccessRoute(pathname, effectiveRole)) {
      router.replace('/');
    }
  }, [status, pathname, effectiveRole, router]);

  if (status === 'loading') {
    return (
      <LoadingState
        title="Loading your workspace"
        description="Fetching account and clinic access from the API."
      />
    );
  }

  if (status === 'unauthenticated') {
    return (
      <LoadingState title="Redirecting to sign in" description="Dev login is required in local mode." />
    );
  }

  if (status === 'inactive') {
    return (
      <ErrorState
        title="Account inactive"
        description="Your user account is inactive. Contact your clinic administrator to restore access."
      />
    );
  }

  if (status === 'error') {
    return (
      <ErrorState
        title="Authentication failed"
        description={error ?? 'Unable to verify your session.'}
      >
        {errorCode ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-red-500">{errorCode}</p>
        ) : null}
      </ErrorState>
    );
  }

  if (!canAccessRoute(pathname, effectiveRole)) {
    return (
      <LoadingState
        title="Access restricted"
        description="This area is not available for your role. Redirecting to Home."
      />
    );
  }

  return <>{children}</>;
}
