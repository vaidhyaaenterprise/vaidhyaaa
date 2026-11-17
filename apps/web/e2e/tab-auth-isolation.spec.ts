import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const CLINIC_ID = '00000000-0000-4000-8000-000000000301';
const DOCTOR_ID = '00000000-0000-4000-8000-000000000401';
const PROFILE_KEY = 'vaidya_dev_auth';
const TOKEN_KEY = 'vaidya_access_token';

function account(role: 'doctor' | 'clinic_admin') {
  return {
    user: {
      id:
        role === 'doctor'
          ? '00000000-0000-4000-8000-000000000101'
          : '00000000-0000-4000-8000-000000000102',
      name: role === 'doctor' ? 'Doctor Tab Account' : 'Admin Tab Account',
      email: 'shared@example.test',
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
  const protectedRequests: Array<{ page: Page; token: string | undefined }> = [];
  await context.route('**/api/backend/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const token = request.headers().authorization;
    let data: unknown;
    if (path.endsWith('/auth/login')) {
      const role = request.postDataJSON().role as 'doctor' | 'clinic_admin';
      data = { ...account(role), access_token: `${role}-token` };
    } else {
      protectedRequests.push({ page: request.frame().page(), token });
      if (!token) {
        await route.fulfill({
          status: 401,
          json: { error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } },
        });
        return;
      }
      if (path.endsWith('/me'))
        data = account(token === 'Bearer doctor-token' ? 'doctor' : 'clinic_admin');
      else if (path.endsWith('/profile'))
        data = {
          clinic: {
            name: 'Tab Session Clinic',
            clinic_unique_number: 1003,
            primary_phone: '9876543210',
            address_line1: 'Test Street',
            address_line2: null,
            city: 'Chennai',
            state: 'Tamil Nadu',
            postal_code: '600097',
            country: 'India',
            timezone: 'Asia/Kolkata',
          },
        };
      else if (path.endsWith('/appointments')) data = { appointments: [] };
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
      json: { data, meta: { request_id: 'req_tab_e2e', debug: null } },
    });
  });
  return protectedRequests;
}

async function signIn(page: Page, role: 'doctor' | 'clinic_admin') {
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page
    .getByRole('button', { name: role === 'doctor' ? 'Doctor' : 'Clinic Admin', exact: true })
    .click();
  await page.getByPlaceholder('Email Address').fill('shared@example.test');
  await page.getByPlaceholder('Password', { exact: true }).fill('test-password');
  await page.getByPlaceholder('Password', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/$/);
  if (role === 'doctor')
    await expect(page.getByText('Doctor Portal', { exact: true })).toBeVisible();
  else await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
}

async function savedRole(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key) ?? 'null')?.role ?? null,
    PROFILE_KEY,
  );
}

test('a manually opened clinic-admin deep link inherits the verified browser session', async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const requests = await mockApi(context);
  await page.goto('/login');
  await signIn(page, 'clinic_admin');
  const deepLinkTab = await context.newPage();
  await deepLinkTab.setViewportSize({ width: 1440, height: 900 });
  await deepLinkTab.goto('/knowledge-base');
  await expect(deepLinkTab).toHaveURL(/\/knowledge-base$/);
  await expect(
    deepLinkTab.getByRole('heading', { name: 'Knowledge base', exact: true }),
  ).toBeVisible();
  expect(await savedRole(page)).toBe('clinic_admin');
  expect(await savedRole(deepLinkTab)).toBe('clinic_admin');
  expect(requests.filter((request) => request.page === deepLinkTab).length).toBeGreaterThan(0);
  expect(
    requests
      .filter((request) => request.page === deepLinkTab)
      .every((request) => request.token === 'Bearer clinic_admin-token'),
  ).toBe(true);
  await deepLinkTab.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(deepLinkTab).toHaveURL(/\/login$/);
  await expect(page).toHaveURL(/\/login$/);
  expect(await deepLinkTab.evaluate((key) => sessionStorage.getItem(key), TOKEN_KEY)).toBeNull();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), TOKEN_KEY)).toBeNull();
});

test('a new doctor tab restores the shared session while the original tab is frozen', async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const requests = await mockApi(context);
  await page.goto('/login');
  await signIn(page, 'doctor');
  const sourceCdp = await context.newCDPSession(page);
  await sourceCdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  const copiedTab = await context.newPage();
  try {
    await copiedTab.goto('/');
    await expect(copiedTab.getByText('Doctor Portal', { exact: true })).toBeVisible();
    expect(await savedRole(copiedTab)).toBe('doctor');
    expect(requests.filter((request) => request.page === copiedTab).length).toBeGreaterThan(0);
    expect(
      requests
        .filter((request) => request.page === copiedTab)
        .every((request) => request.token === 'Bearer doctor-token'),
    ).toBe(true);
  } finally {
    await sourceCdp.send('Page.setWebLifecycleState', { state: 'active' });
  }
  await expect(page.getByText('Doctor Portal', { exact: true })).toBeVisible();
  expect(await savedRole(page)).toBe('doctor');
});
