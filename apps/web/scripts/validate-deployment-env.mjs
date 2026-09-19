import { pathToFileURL } from 'node:url';

const LOOPBACK_HOSTNAMES = new Set(['localhost', '0.0.0.0', '::', '::1']);

function normalizeHostname(hostname) {
  const normalized = hostname.toLowerCase();
  const withoutBrackets =
    normalized.startsWith('[') && normalized.endsWith(']') ? normalized.slice(1, -1) : normalized;
  return withoutBrackets.endsWith('.') ? withoutBrackets.slice(0, -1) : withoutBrackets;
}

function isPrivateIpv4(hostname) {
  const octets = hostname.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function validateDeploymentEnvironment(environment) {
  if (!environment.VERCEL) {
    return;
  }

  const rawValue = environment.API_BASE_URL?.trim();
  if (!rawValue) {
    throw new Error('API_BASE_URL is required for Vercel deployments.');
  }

  let apiUrl;
  try {
    apiUrl = new URL(rawValue);
  } catch {
    throw new Error('API_BASE_URL must be a valid absolute URL.');
  }

  if (apiUrl.protocol !== 'https:') {
    throw new Error('API_BASE_URL must use HTTPS on Vercel.');
  }
  if (apiUrl.username || apiUrl.password) {
    throw new Error('API_BASE_URL must not contain credentials.');
  }
  if (apiUrl.search || apiUrl.hash) {
    throw new Error('API_BASE_URL must not contain a query string or fragment.');
  }
  if (apiUrl.pathname !== '/' && apiUrl.pathname !== '') {
    throw new Error('API_BASE_URL must be the API origin without a path such as /v1.');
  }

  const hostname = normalizeHostname(apiUrl.hostname);
  if (
    LOOPBACK_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    isPrivateIpv4(hostname)
  ) {
    throw new Error(
      'API_BASE_URL must use the API server public hostname, not loopback or a private network address.',
    );
  }

  const webHostnames = [environment.VERCEL_URL, environment.VERCEL_PROJECT_PRODUCTION_URL]
    .filter(Boolean)
    .map((value) => normalizeHostname(value));
  if (webHostnames.includes(hostname)) {
    throw new Error('API_BASE_URL must point to the API project, not back to the web project.');
  }
}

function run() {
  try {
    validateDeploymentEnvironment(process.env);
    console.log(
      process.env.VERCEL
        ? 'Web deployment environment is valid.'
        : 'Web deployment environment validation skipped outside Vercel.',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown environment validation error';
    console.error(`Web deployment environment is invalid: ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
