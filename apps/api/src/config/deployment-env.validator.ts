import { assertSupabaseTransactionPoolerUrl, type ApiEnv } from '@vaidya/config';

/**
 * Guards assumptions that are specific to the Vercel serverless runtime. The
 * general environment schema remains reusable by local and persistent hosts.
 */
export function assertVercelDeploymentEnv(env: ApiEnv): void {
  if (env.APP_ENV === 'local') {
    throw new Error('APP_ENV must be qa, staging, or production for a Vercel deployment.');
  }

  if (env.AUTH_MODE === 'dev') {
    throw new Error('AUTH_MODE=dev is not allowed for a Vercel deployment.');
  }

  assertSupabaseTransactionPoolerUrl(env.DATABASE_URL);
}
