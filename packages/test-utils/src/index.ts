import { parseApiEnv } from '@vaidya/config';

export const testApiEnv = parseApiEnv({
  NODE_ENV: 'test',
  APP_ENV: 'local',
  API_PORT: '3000',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/vaidya_test',
  JWT_SECRET: 'test_secret',
  API_BASE_URL: 'http://localhost:3000',
});

export function createTestRequestId(): string {
  return 'req_test_fixture';
}
