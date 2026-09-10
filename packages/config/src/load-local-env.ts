import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseEnvFile(path: string): void {
  const content = readFileSync(path, 'utf8');

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (value === '') {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
}

/**
 * Loads `.env` files for local development.
 * Later files override earlier ones (app `.env` wins over repo root).
 */
export function loadLocalEnv(cwd: string = process.cwd()): void {
  const envFiles = [
    resolve(cwd, '../../.env'),
    resolve(cwd, '../.env'),
    resolve(cwd, '.env'),
  ];

  for (const envFile of envFiles) {
    if (existsSync(envFile)) {
      parseEnvFile(envFile);
    }
  }
}
