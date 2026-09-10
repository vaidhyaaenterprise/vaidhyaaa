import type { NextConfig } from 'next';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: join(appDir, '../..'),
  reactStrictMode: true,
  transpilePackages: ['@vaidya/shared'],
};

export default nextConfig;
