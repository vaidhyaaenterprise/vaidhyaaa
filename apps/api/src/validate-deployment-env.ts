import { parseApiEnv } from '@vaidya/config';

try {
  parseApiEnv(process.env);
  console.log('API deployment environment is valid.');
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown environment validation error';
  console.error(`API deployment environment is invalid: ${message}`);
  process.exitCode = 1;
}
