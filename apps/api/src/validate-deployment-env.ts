import { parseApiEnv } from '@vaidya/config';

import { assertVercelDeploymentEnv } from './config/deployment-env.validator';

try {
  const env = parseApiEnv(process.env);
  if (process.env.VERCEL) {
    assertVercelDeploymentEnv(env);
  }
  console.log('API deployment environment is valid.');
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown environment validation error';
  console.error(`API deployment environment is invalid: ${message}`);
  process.exitCode = 1;
}
