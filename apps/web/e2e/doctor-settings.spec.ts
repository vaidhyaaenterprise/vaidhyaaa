import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

const CLINIC_ID = '00000000-0000-4000-8000-000000000301';
const DOCTOR_ID = '00000000-0000-4000-8000-000000000401';
const OTHER_DOCTOR_ID = '00000000-0000-4000-8000-000000000402';
const RULE_ID = '00000000-0000-4000-8000-000000000501';
const QUALIFICATION = 'MBBS, MD (General Medicine)';
const ADDRESS = '42 Clinic Road, Near Central Park, Chennai, Tamil Nadu, 600097';

type Holiday = {
  id: string;
  holiday_date: string;
  reason: string;
  is_full_day: boolean;
  active: boolean;
  applies_to_clinic: boolean;
  doctor_ids: string[];
};

async function mockDoctorApi(context: BrowserContext) {
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  const unexpected: string[] = [];
  const identity = {
    user: {
      id: '00000000-0000-4000-8000-000000000101',
      name: 'Staff Login Name',
      email: 'doctor@example.test',
      phone: null,
      platform_role: null,
      active: true,
    },
    clinics: [{ clinic_id: CLINIC_ID, role: 'doctor', doctor_id: DOCTOR_ID, active: true }],
  };
  const holidays: Holiday[] = [
    {
      id: '00000000-0000-4000-8000-000000000601',
      holiday_date: '2099-12-20',
      reason: 'Clinic closure',
      is_full_day: true,
      active: true,
      applies_to_clinic: true,
      doctor_ids: [],
    },
    {
      id: '00000000-0000-4000-8000-000000000602',
      holiday_date: '2099-12-21',
      reason: 'Shared team leave',
      is_full_day: true,
      active: true,
      applies_to_clinic: false,
      doctor_ids: [DOCTOR_ID, OTHER_DOCTOR_ID],
    },
  ];

  await context.route('**/api/backend/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const body = ['POST', 'PUT', 'PATCH'].includes(method)
      ? (request.postDataJSON() as Record<string, unknown>)
      : {};
    if (!['GET', 'HEAD'].includes(method) && !path.endsWith('/auth/login')) {
      writes.push({ path, body });
    }
    let data: unknown;
    if (path.endsWith('/auth/login')) {
      expect(body.role).toBe('doctor');
      data = { ...identity, access_token: 'doctor-settings-test-token' };
    } else if (!request.headers().authorization) {
      await route.fulfill({
        status: 401,
        json: { error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } },
      });
      return;
    } else if (path.endsWith('/me')) data = identity;
    else if (path.endsWith('/profile') && method === 'GET') {
      data = {
        clinic: {
          name: 'Doctor Settings Clinic',
          clinic_unique_number: 1003,
          primary_phone: '9876543210',
          address_line1: '42 Clinic Road',
          address_line2: 'Near Central Park',
          city: 'Chennai',
          state: 'Tamil Nadu',
          postal_code: '600097',
          country: 'India',
          timezone: 'Asia/Kolkata',
        },
      };
    } else if (path.endsWith('/doctors') && method === 'GET') {
      data = {
        doctors: [
          {
            id: DOCTOR_ID,
            name: 'Dr. Asha Raman',
            qualification: QUALIFICATION,
            active: true,
            user_id: identity.user.id,
          },
          {
            id: OTHER_DOCTOR_ID,
            name: 'Dr. Other Doctor',
            qualification: 'MS',
            active: true,
            user_id: null,
          },
        ],
      };
    } else if (path.endsWith('/appointments') && method === 'GET') data = { appointments: [] };
    else if (path.endsWith('/hours') && method === 'GET') {
      data = {
        hours: [
          {
            id: 'clinic-monday',
            day_of_week: 1,
            start_time: '09:00',
            end_time: '17:00',
            active: true,
          },
        ],
      };
    } else if (path.endsWith('/doctor-services') && method === 'GET') {
      data = {
        doctor_services: [
          {
            id: 'self-service',
            doctor_id: DOCTOR_ID,
            clinic_service_id: 'service-1',
            consultation_fee_amount: '500',
            active: true,
          },
        ],
      };
    } else if (path.endsWith('/services') && method === 'GET') {
      data = {
        services: [
          {
            id: 'service-1',
            service_name: 'General Consultation',
            service_key: 'general_consultation',
            active: true,
          },
        ],
      };
    } else if (path.endsWith('/holidays') && method === 'GET') data = { holidays };
    else if (path.endsWith('/holidays') && method === 'POST') {
      const created: Holiday = {
        id: '00000000-0000-4000-8000-000000000603',
        holiday_date: String(body.holiday_date),
        reason: String(body.reason),
        is_full_day: true,
        active: body.active !== false,
        applies_to_clinic: false,
        doctor_ids: body.doctor_ids as string[],
      };
      holidays.push(created);
      data = { holiday: created };
    } else if (path.endsWith(`/doctors/${DOCTOR_ID}/schedules`) && method === 'GET') {
      data = {
        schedules: [
          {
            id: 'self-monday',
            doctor_id: DOCTOR_ID,
            day_of_week: 1,
            start_time: '09:00',
            end_time: '13:00',
            active: true,
          },
        ],
      };
    } else if (path.endsWith(`/doctors/${DOCTOR_ID}/schedules`) && method === 'PUT') {
      await route.fulfill({
        status: 409,
        json: {
          error: {
            code: 'CONFLICTING_APPOINTMENTS',
            message: 'Schedule conflicts with booked appointments.',
            request_id: 'req_doctor_conflict_e2e',
            details: {
              conflicts: [
                {
                  appointment_id: '00000000-0000-4000-8000-000000000701',
                  appointment: {
                    patient_name: 'Asha Patient',
                    appointment_start: '2099-12-21 12:30:00',
                    appointment_end: '2099-12-21 12:45:00',
                    doctor_name: 'Dr. Asha Raman',
                    service_name: 'General consultation',
                    status: 'confirmed',
                  },
                  reason: 'outside_doctor_hours',
                },
              ],
            },
          },
        },
      });
      return;
    } else if (path.endsWith('/booking-rules') && method === 'GET') {
      data = {
        booking_rules: [
          {
            id: RULE_ID,
            doctor_id: DOCTOR_ID,
            clinic_service_id: 'service-1',
            slot_duration_minutes: 15,
            capacity_per_slot: 1,
            booking_horizon_days: 45,
            active: true,
          },
        ],
      };
    } else if (path.endsWith('/slot-reconciliation/status') && method === 'GET') {
      data = { state: 'ready', remaining: 0, failed: 0 };
    } else {
      unexpected.push(`${method} ${path}`);
      await route.fulfill({
        status: 404,
        json: { error: { code: 'NOT_FOUND', message: 'Unexpected test request.' } },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json: { data, meta: { request_id: 'req_doctor_settings_e2e', debug: null } },
    });
  });
  return { writes, unexpected };
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Doctor', exact: true }).click();
  await page.getByPlaceholder('Email Address').fill('doctor@example.test');
  await page.getByPlaceholder('Password', { exact: true }).fill('doctor-test-password');
  await page.getByPlaceholder('Password', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/doctor\/?$/);
}

function card(page: Page, title: string): Locator {
  return page.getByRole('heading', { name: title, exact: true }).locator('..').locator('..');
}

async function openSettings(page: Page, mobile = false) {
  await page
    .getByRole('navigation', {
      name: mobile ? 'Doctor mobile navigation' : 'Doctor navigation',
      exact: true,
    })
    .getByRole('link', { name: 'Settings', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(card(page, 'Booking rules').getByText('15 minutes', { exact: true })).toBeVisible();
  await expect(card(page, 'Holiday setup').getByText(/Shared team leave/)).toBeVisible();
}

test('desktop doctor sidebar shows real qualification, read-only full address, Settings and bottom logout', async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { writes, unexpected } = await mockDoctorApi(context);
  await signIn(page);
  const sidebar = page.locator('aside');
  await expect(sidebar.getByText(QUALIFICATION, { exact: true })).toBeVisible();
  await expect(sidebar.getByText('Dr. Asha Raman', { exact: true })).toBeVisible();
  await expect(sidebar.getByText(ADDRESS, { exact: true })).toBeVisible();
  await expect(sidebar.getByText('Clinic line: 9876543210', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit clinic details' })).toHaveCount(0);
  await expect(page.getByText('On Duty', { exact: true })).toHaveCount(0);
  const logout = sidebar.getByRole('button', { name: 'Logout' });
  const bounds = await logout.boundingBox();
  expect(bounds?.y).toBeGreaterThan(780);
  await openSettings(page);
  await expect(page.getByRole('heading', { name: 'Doctor schedules', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByText('Dr. Other Doctor', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/vaidhyaa-doctor-settings-desktop.png', fullPage: true });
  await logout.click();
  await expect(page).toHaveURL(/\/login$/);
  expect(writes).toEqual([]);
  expect(unexpected).toEqual([]);
});

test('personal holiday saves for the authenticated doctor and reloads while clinic/shared holidays stay read-only', async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { writes, unexpected } = await mockDoctorApi(context);
  await signIn(page);
  await openSettings(page);
  const holidays = card(page, 'Holiday setup');
  await expect(
    holidays.getByText('Set by clinic admin · Read only', { exact: true }),
  ).toBeVisible();
  await expect(holidays.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
  await holidays.getByRole('button', { name: 'Edit', exact: true }).click();
  await holidays.getByRole('button', { name: '+ Add holiday', exact: true }).click();
  await expect(holidays.getByRole('checkbox')).toHaveCount(0);
  await holidays.getByLabel('Holiday date').fill('2099-12-23');
  await holidays.getByLabel('Holiday reason').fill('Personal leave');
  await holidays.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(holidays.getByText('Personal leave', { exact: true })).toBeVisible();
  expect(writes).toEqual([
    {
      path: `/api/backend/v1/clinics/${CLINIC_ID}/holidays`,
      body: {
        holiday_date: '2099-12-23',
        reason: 'Personal leave',
        active: true,
        doctor_ids: [DOCTOR_ID],
      },
    },
  ]);
  await page
    .getByRole('navigation', { name: 'Doctor navigation', exact: true })
    .getByRole('link', { name: /^Today/ })
    .click();
  await openSettings(page);
  await expect(holidays.getByText('Personal leave', { exact: true })).toBeVisible();
  await expect(holidays.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(1);
  expect(unexpected).toEqual([]);
});

test('doctor schedule edits show the conflicting appointment and keep the editor open', async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { writes, unexpected } = await mockDoctorApi(context);
  await signIn(page);
  await openSettings(page);
  const schedule = card(page, 'Doctor schedules');
  await schedule.getByRole('button', { name: 'Edit', exact: true }).click();
  await schedule.getByLabel('End', { exact: true }).fill('12:00');
  await schedule.getByRole('button', { name: 'Save', exact: true }).click();
  const conflict = schedule.getByRole('alert', { name: 'Schedule conflicts', exact: true });
  await expect(conflict).toContainText('Asha Patient');
  await expect(conflict).toContainText('Dr. Asha Raman');
  await expect(conflict).toContainText('12:30 PM');
  await expect(schedule.getByLabel('End', { exact: true })).toHaveValue('12:00');
  await expect(
    schedule.getByRole('button', { name: 'Recheck and save', exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([
    {
      path: `/api/backend/v1/clinics/${CLINIC_ID}/doctors/${DOCTOR_ID}/schedules`,
      body: { windows: [{ day_of_week: 1, start_time: '09:00', end_time: '12:00', active: true }] },
    },
  ]);
  expect(unexpected).toEqual([]);
});

test('mobile doctors can reach Settings with all sections inside the viewport width', async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { unexpected } = await mockDoctorApi(context);
  await signIn(page);
  const mobileNav = page.getByRole('navigation', { name: 'Doctor mobile navigation', exact: true });
  await expect(mobileNav).toBeVisible();
  await expect(page.locator('main').getByText(QUALIFICATION, { exact: true })).toBeVisible();
  await expect(page.locator('main').getByText(ADDRESS, { exact: true })).toBeVisible();
  await openSettings(page, true);
  await expect(page.getByRole('heading', { name: 'Doctor schedules', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '/tmp/vaidhyaa-doctor-settings-mobile.png', fullPage: true });
  expect(unexpected).toEqual([]);
});
