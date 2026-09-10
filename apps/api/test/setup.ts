import 'reflect-metadata';

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'local';
process.env.API_PORT = '3000';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/vaidya_test';
process.env.JWT_SECRET = 'test_secret';
process.env.API_BASE_URL = 'http://localhost:3000';
process.env.AUTH_MODE = 'dev';
process.env.LOG_LEVEL = 'error';
process.env.DEV_USER_ID = '00000000-0000-0000-0000-000000000102';
process.env.DEV_CLINIC_ID = '00000000-0000-0000-0000-000000000001';
process.env.DEV_USER_ROLE = 'clinic_admin';
process.env.QUEUE_MODE = 'inline';
process.env.JOB_WORKER_ENABLED = 'false';
delete process.env.REDIS_URL;
delete process.env.DEV_DOCTOR_ID;
