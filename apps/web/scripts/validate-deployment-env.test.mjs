import { describe, expect, it } from 'vitest';

import { validateDeploymentEnvironment } from './validate-deployment-env.mjs';

function vercelEnvironment(overrides = {}) {
  return {
    VERCEL: '1',
    VERCEL_URL: 'web-preview.example.test',
    VERCEL_PROJECT_PRODUCTION_URL: 'web.example.test',
    API_BASE_URL: 'https://api.example.test',
    ...overrides,
  };
}

describe('web deployment environment validation', () => {
  it('accepts a public HTTPS API origin', () => {
    expect(() => validateDeploymentEnvironment(vercelEnvironment())).not.toThrow();
  });

  it('does not enforce Vercel settings during ordinary local builds', () => {
    expect(() => validateDeploymentEnvironment({})).not.toThrow();
  });

  it.each([
    ['', 'required'],
    ['http://api.example.test', 'HTTPS'],
    ['https://localhost:3000', 'public hostname'],
    ['https://127.0.0.1:3000', 'public hostname'],
    ['https://10.0.0.5', 'public hostname'],
    ['https://api.example.test/v1', 'without a path'],
    ['https://user:secret@api.example.test', 'must not contain credentials'],
    ['not-a-url', 'valid absolute URL'],
  ])('rejects an unusable API_BASE_URL value: %s', (apiBaseUrl, expectedMessage) => {
    expect(() =>
      validateDeploymentEnvironment(vercelEnvironment({ API_BASE_URL: apiBaseUrl })),
    ).toThrow(expectedMessage);
  });

  it('rejects the web deployment itself as the API origin', () => {
    expect(() =>
      validateDeploymentEnvironment(
        vercelEnvironment({ API_BASE_URL: 'https://web-preview.example.test' }),
      ),
    ).toThrow('not back to the web project');
  });
});
