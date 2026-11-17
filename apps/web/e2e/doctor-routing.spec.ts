import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const CLINIC_ID = '00000000-0000-4000-8000-000000000301';
const DOCTOR_ID = '00000000-0000-4000-8000-000000000401';
const PROFILE_KEY = 'vaidya_dev_auth';
const TOKEN_KEY = 'vaidya_access_token';
const SHARED_KEY = 'vaidya_shared_auth_session_v1';

type Role = 'doctor' | 'clinic_admin';

function account(role: Role) {
  return {
    user: {
      id:
        role === 'doctor'
          ? '00000000-0000-4000-8000-000000000101'
          : '00000000-0000-4000-8000-000000000102',
      name: role === 'doctor' ? 'Doctor Routing Account' : 'Admin Routing Account',
      email: 'routing@example.test',
      phone: null,
      platform_role: null,
      active: true,
    },
    clinics: [
      { clinic_id: CLINIC_ID, role, doctor_id: role === 'doctor' ? DOCTOR_ID : null, active: true },
    ],
  };
}

async function mockApi(context: BrowserContext) {
  const protectedRequests: Array<{ page: Page; token: string | undefined; path: string }> = [];
  const logins: Role[] = [];
  await context.route('**/api/backend/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const token = request.headers().authorization;
    let data: unknown;
    if (path.endsWith('/auth/login')) {
      const role = request.postDataJSON().role as Role;
      logins.push(role);
      data = { ...account(role), access_token: `${role}-token` };
    } else {
      protectedRequests.push({ page: request.frame().page(), token, path });
      if (!token || !['Bearer doctor-token', 'Bearer clinic_admin-token'].includes(token)) {
        await route.fulfill({
          status: 401,
          json: {
            error: {
              code: 'UNAUTHORIZED',
              message: 'Sign in required.',
              request_id: 'req_routing_auth',
            },
          },
        });
        return;
      }
      if (path.endsWith('/me'))
        data = account(token === 'Bearer doctor-token' ? 'doctor' : 'clinic_admin');
      else if (path.endsWith('/profile'))
        data = {
          clinic: {
            name: 'Routing Test Clinic',
            clinic_unique_number: 1003,
            primary_phone: '9876543210',
            address_line1: '42 Clinic Road',
            address_line2: 'Central Park',
            city: 'Chennai',
            state: 'Tamil Nadu',
            postal_code: '600097',
            country: 'India',
            timezone: 'Asia/Kolkata',
          },
        };
      else if (path.endsWith('/doctors'))
        data = {
          doctors: [
            {
              id: DOCTOR_ID,
              name: 'Doctor Routing Account',
              qualification: 'MBBS, MD',
              active: true,
              user_id: account('doctor').user.id,
            },
          ],
        };
      else if (path.endsWith('/appointments')) data = { appointments: [] };
      else if (path.endsWith('/schedules')) data = { schedules: [] };
      else if (path.endsWith('/hours')) data = { hours: [] };
      else if (path.endsWith('/holidays')) data = { holidays: [] };
      else if (path.endsWith('/doctor-services')) data = { doctor_services: [] };
      else if (path.endsWith('/services')) data = { services: [] };
      else if (path.endsWith('/booking-rules')) data = { booking_rules: [] };
      else if (path.endsWith('/slot-reconciliation/status'))
        data = { state: 'ready', remaining: 0, failed: 0 };
      else if (path.endsWith('/knowledge/entries')) data = { entries: [] };
      else if (path.endsWith('/knowledge/embedding-status')) data = { embedding_status: null };
      else if (path.endsWith('/settings'))
        data = {
          settings: {
            clinic_id: CLINIC_ID,
            agent_enabled: false,
            allow_doctor_service_edit: false,
            booking_mode: 'request',
            answering_mode: 'always',
            max_concurrent_calls: 1,
          },
        };
      else data = {};
    }
    await route.fulfill({
      status: 200,
      json: { data, meta: { request_id: 'req_doctor_routing_e2e', debug: null } },
    });
  });
  return { protectedRequests, logins };
}

async function signIn(page: Page, role: Role, expectedPath = role === 'doctor' ? '/doctor' : '/') {
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: role === 'doctor' ? 'Doctor' : 'Clinic Admin', exact: true })
    .click();
  await page.getByPlaceholder('Email Address').fill('routing@example.test');
  await page.getByPlaceholder('Password', { exact: true }).fill('routing-test-password');
  await page.getByPlaceholder('Password', { exact: true }).press('Enter');
  await expect.poll(() => new URL(page.url()).pathname).toBe(expectedPath);
}

async function expectSection(page: Page, path: string, heading: string) {
  await expect.poll(() => new URL(page.url()).pathname).toBe(path);
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
}

async function savedRole(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key) ?? 'null')?.role ?? null,
    PROFILE_KEY,
  );
}

async function snapshotTab(page: Page) {
  return page.evaluate(() =>
    Object.fromEntries(
      Object.keys(sessionStorage).map((key) => [key, sessionStorage.getItem(key)!]),
    ),
  );
}

async function installCopiedTab(
  page: Page,
  entries: Record<string, string>,
  reloadNavigation = false,
) {
  await page.addInitScript(
    ({ values, isReload }) => {
      if (sessionStorage.getItem('__routing_clone_installed')) return;
      for (const [key, value] of Object.entries(values)) sessionStorage.setItem(key, value);
      sessionStorage.setItem('__routing_clone_installed', 'true');
      if (isReload) {
        const nativeEntries = performance.getEntriesByType.bind(performance);
        performance.getEntriesByType = (type) =>
          type === 'navigation'
            ? [
                new Proxy(nativeEntries(type)[0] ?? {}, {
                  get: (target, property) =>
                    property === 'type' ? 'reload' : Reflect.get(target, property),
                }) as PerformanceEntry,
              ]
            : nativeEntries(type);
      }
    },
    { values: entries, isReload: reloadNavigation },
  );
}

test('doctor navigation uses distinct URLs that survive refresh and browser Back/Forward', async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockApi(context);
  await page.goto('/login');
  await signIn(page, 'doctor');
  const nav = page.getByRole('navigation', { name: 'Doctor navigation', exact: true });
  const analytics = nav.getByRole('link', { name: 'Analytics', exact: true });
  await expect(analytics).toHaveAttribute('href', '/doctor/analytics');
  await analytics.click();
  await expectSection(page, '/doctor/analytics', 'Patient Analytics');
  await expect(analytics).toHaveAttribute('aria-current', 'page');
  await page.reload();
  await expectSection(page, '/doctor/analytics', 'Patient Analytics');
  await nav.getByRole('link', { name: 'Patient History', exact: true }).click();
  await expectSection(page, '/doctor/patient-history', 'Patient History');
  await nav.getByRole('link', { name: 'Settings', exact: true }).click();
  await expectSection(page, '/doctor/settings', 'Settings');
  await page.reload();
  await expectSection(page, '/doctor/settings', 'Settings');
  await page.goBack();
  await expectSection(page, '/doctor/patient-history', 'Patient History');
  await page.goBack();
  await expectSection(page, '/doctor/analytics', 'Patient Analytics');
  await page.goForward();
  await expectSection(page, '/doctor/patient-history', 'Patient History');
  await nav.getByRole('link', { name: /^Today/ }).click();
  await expectSection(page, '/doctor', "Today's Queue");
});

test('mobile doctor navigation changes URL and keeps the selected section on reload', async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(context);
  await page.goto('/login');
  await signIn(page, 'doctor');
  const settings = page
    .getByRole('navigation', { name: 'Doctor mobile navigation', exact: true })
    .getByRole('link', { name: 'Settings', exact: true });
  await settings.click();
  await expectSection(page, '/doctor/settings', 'Settings');
  await expect(settings).toHaveAttribute('aria-current', 'page');
  await page.reload();
  await expectSection(page, '/doctor/settings', 'Settings');
});

test('signing in from a protected doctor deep link returns to that exact section', async ({
  context,
  page,
}) => {
  const api = await mockApi(context);
  await page.goto('/doctor/settings');
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('next')).toBe('/doctor/settings');
  await signIn(page, 'doctor', '/doctor/settings');
  await expectSection(page, '/doctor/settings', 'Settings');
  expect(api.logins).toEqual(['doctor']);
});

test('doctor and clinic-admin deep links cannot open the other role portal', async ({
  context,
  page,
}) => {
  const api = await mockApi(context);
  await page.goto('/login');
  await signIn(page, 'doctor');
  await page.goto('/knowledge-base');
  await expectSection(page, '/doctor', "Today's Queue");
  await expect(page.getByRole('heading', { name: 'Knowledge base', exact: true })).toHaveCount(0);
  await page
    .locator('aside')
    .getByRole('button', { name: /Logout/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await signIn(page, 'clinic_admin');
  await page.goto('/doctor/patient-history');
  await expectSection(page, '/', 'Home');
  await expect(page.getByText('Doctor Portal', { exact: true })).toHaveCount(0);
  expect(await savedRole(page)).toBe('clinic_admin');
  expect(api.logins).toEqual(['doctor', 'clinic_admin']);
});

test('new tabs with and without an opener inherit the verified doctor session while its source is frozen', async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const api = await mockApi(context);
  await page.goto('/login');
  await signIn(page, 'doctor');
  await page
    .getByRole('navigation', { name: 'Doctor navigation', exact: true })
    .getByRole('link', { name: 'Settings', exact: true })
    .click();
  await expectSection(page, '/doctor/settings', 'Settings');
  // window.open performs Chrome's native opener-sessionStorage clone.
  const popupPromise = page.waitForEvent('popup');
  await page.evaluate(() => {
    window.open('about:blank', '_blank');
  });
  const withOpener = await popupPromise;
  const withoutOpener = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  try {
    await withOpener.goto('/doctor/settings');
    await expectSection(withOpener, '/doctor/settings', 'Settings');
    await withoutOpener.goto('/doctor/analytics');
    await expectSection(withoutOpener, '/doctor/analytics', 'Patient Analytics');
    for (const opened of [withOpener, withoutOpener]) {
      expect(await savedRole(opened)).toBe('doctor');
      const requests = api.protectedRequests.filter((request) => request.page === opened);
      expect(requests.some((request) => request.path.endsWith('/me'))).toBe(true);
      expect(requests.every((request) => request.token === 'Bearer doctor-token')).toBe(true);
    }
    expect(api.logins).toEqual(['doctor']);
  } finally {
    await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  }
  await expectSection(page, '/doctor/settings', 'Settings');
});

test('a duplicated reload document keeps the copied doctor session without a live original-tab handshake', async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const api = await mockApi(context);
  await page.goto('/login');
  await signIn(page, 'doctor');
  await page
    .getByRole('navigation', { name: 'Doctor navigation', exact: true })
    .getByRole('link', { name: 'Patient History', exact: true })
    .click();
  await expectSection(page, '/doctor/patient-history', 'Patient History');
  const entries = await snapshotTab(page);
  const duplicate = await context.newPage();
  await installCopiedTab(duplicate, entries, true);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  try {
    await duplicate.goto('/doctor/patient-history');
    await expectSection(duplicate, '/doctor/patient-history', 'Patient History');
    expect(
      await duplicate.evaluate(
        () =>
          (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)
            ?.type,
      ),
    ).toBe('reload');
    expect(await savedRole(duplicate)).toBe('doctor');
    expect(api.logins).toEqual(['doctor']);
    expect(
      api.protectedRequests
        .filter((request) => request.page === duplicate)
        .every((request) => request.token === 'Bearer doctor-token'),
    ).toBe(true);
  } finally {
    await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  }
  await expectSection(page, '/doctor/patient-history', 'Patient History');
});

test('a stale doctor clone cannot override the current verified clinic-admin session', async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const api = await mockApi(context);
  await page.goto('/login');
  await signIn(page, 'doctor');
  const oldDoctorEntries = await snapshotTab(page);
  await page
    .locator('aside')
    .getByRole('button', { name: /Logout/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await signIn(page, 'clinic_admin');
  const currentSharedSession = await page.evaluate((key) => localStorage.getItem(key), SHARED_KEY);
  const duplicate = await context.newPage();
  await installCopiedTab(duplicate, oldDoctorEntries, true);
  await duplicate.goto('/doctor/settings');
  await expectSection(duplicate, '/', 'Home');
  expect(await savedRole(duplicate)).toBe('clinic_admin');
  expect(await duplicate.evaluate((key) => localStorage.getItem(key), SHARED_KEY)).toBe(
    currentSharedSession,
  );
  const cloneRequests = api.protectedRequests.filter((request) => request.page === duplicate);
  expect(cloneRequests.some((request) => request.path.endsWith('/me'))).toBe(true);
  expect(cloneRequests.every((request) => request.token === 'Bearer clinic_admin-token')).toBe(
    true,
  );
  expect(api.logins).toEqual(['doctor', 'clinic_admin']);
});

test('a legacy copied token is verified and restored when only the old localStorage profile exists', async ({
  context,
  page,
}) => {
  const api = await mockApi(context);
  await page.addInitScript(
    ({ tokenKey, profileKey }) => {
      sessionStorage.setItem(tokenKey, 'doctor-token');
      localStorage.setItem(
        profileKey,
        JSON.stringify({
          userId: '00000000-0000-4000-8000-000000000101',
          clinicId: '00000000-0000-4000-8000-000000000301',
          role: 'doctor',
          doctorId: '00000000-0000-4000-8000-000000000401',
        }),
      );
    },
    { tokenKey: TOKEN_KEY, profileKey: PROFILE_KEY },
  );
  await page.goto('/doctor/settings');
  await expectSection(page, '/doctor/settings', 'Settings');
  expect(await savedRole(page)).toBe('doctor');
  expect(api.logins).toEqual([]);
  expect(api.protectedRequests.some((request) => request.path.endsWith('/me'))).toBe(true);
  expect(api.protectedRequests.every((request) => request.token === 'Bearer doctor-token')).toBe(
    true,
  );
});

test('a legacy role profile without a token cannot authenticate a doctor deep link', async ({
  context,
  page,
}) => {
  const api = await mockApi(context);
  await page.addInitScript(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          userId: '00000000-0000-4000-8000-000000000101',
          clinicId: '00000000-0000-4000-8000-000000000301',
          role: 'doctor',
          doctorId: '00000000-0000-4000-8000-000000000401',
        }),
      ),
    PROFILE_KEY,
  );
  await page.goto('/doctor/settings');
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toHaveCount(0);
  expect(api.logins).toEqual([]);
  expect(api.protectedRequests).toEqual([]);
});

test('a copied pre-logout doctor session cannot revive after shared sign-out', async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const api = await mockApi(context);
  await page.goto('/login');
  await signIn(page, 'doctor');
  const oldEntries = await snapshotTab(page);
  await page
    .locator('aside')
    .getByRole('button', { name: /Logout/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  const duplicate = await context.newPage();
  await installCopiedTab(duplicate, oldEntries, true);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  try {
    await duplicate.goto('/doctor/settings');
    await expect(
      duplicate.getByRole('heading', { name: 'Welcome back', exact: true }),
    ).toBeVisible();
    expect(await duplicate.evaluate((key) => sessionStorage.getItem(key), TOKEN_KEY)).toBeNull();
    expect(await savedRole(duplicate)).toBeNull();
    expect(api.protectedRequests.filter((request) => request.page === duplicate)).toEqual([]);
    expect(api.logins).toEqual(['doctor']);
  } finally {
    await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  }
});
