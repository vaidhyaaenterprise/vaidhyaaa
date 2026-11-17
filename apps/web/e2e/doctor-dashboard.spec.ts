import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

test.use({ timezoneId: 'America/Los_Angeles' });

const CLINIC_ID = '00000000-0000-4000-8000-000000000301';
const DOCTOR_ID = '00000000-0000-4000-8000-000000000401';
const OTHER_DOCTOR_ID = '00000000-0000-4000-8000-000000000402';
const TODAY = '2026-11-17';
const NOW = new Date('2026-11-16T20:15:00Z');

type Appointment = {
  id: string;
  patient_name: string;
  patient_phone: string | null;
  patient_age?: number | null;
  patient_gender?: string | null;
  doctor_id: string;
  doctor_name: string;
  clinic_service_id: string;
  service_name: string;
  appointment_start: string;
  appointment_end: string;
  reason_for_visit: string;
  status: string;
  has_history: boolean;
  visit_type: string;
  routing_source: string;
  source: string;
  created_at: string;
};

function appointment(
  id: string,
  name: string,
  date: string,
  patch: Partial<Appointment> = {},
): Appointment {
  return {
    id,
    patient_name: name,
    patient_phone: '9876543210',
    doctor_id: DOCTOR_ID,
    doctor_name: 'Dr. Asha Raman',
    clinic_service_id: 'general-service',
    service_name: 'General Consultation',
    appointment_start: `${date} 14:00:00`,
    appointment_end: `${date} 14:30:00`,
    reason_for_visit: 'Database recorded general concern',
    status: 'confirmed',
    has_history: false,
    visit_type: 'new',
    routing_source: 'explicit_doctor',
    source: 'manual',
    created_at: '2026-11-16T12:00:00Z',
    ...patch,
  };
}

async function mockDashboardApi(context: BrowserContext) {
  const requests: Array<{ path: string; date: string | null }> = [];
  const unexpected: string[] = [];
  const state = { failAppointments: false };
  const identity = {
    user: {
      id: '00000000-0000-4000-8000-000000000101',
      name: 'Doctor Login',
      email: 'doctor@example.test',
      phone: null,
      platform_role: null,
      active: true,
    },
    clinics: [{ clinic_id: CLINIC_ID, role: 'doctor', doctor_id: DOCTOR_ID, active: true }],
  };
  const schedules = [
    { day: 1, start: '08:35', end: '11:55' },
    { day: 2, start: '13:20', end: '16:40' },
    { day: 3, start: '10:10', end: '12:50' },
    { day: 4, start: '12:15', end: '17:45' },
    { day: 5, start: '10:00', end: '17:00' },
  ].map((window) => ({
    id: `schedule-${window.day}`,
    doctor_id: DOCTOR_ID,
    day_of_week: window.day,
    start_time: window.start,
    end_time: window.end,
    active: true,
  }));
  const clinicHours = [1, 2, 3, 4, 5].map((day) => ({
    id: `clinic-${day}`,
    day_of_week: day,
    start_time: '09:00',
    end_time: '18:00',
    active: true,
  }));
  const rows = new Map<string, Appointment[]>([
    [
      TODAY,
      [
        appointment('arun-live', 'Arun Kumar', TODAY, {
          patient_phone: '+91 98400 12345',
          patient_age: null,
          patient_gender: null,
        }),
        appointment('visited-live', 'Database Visited Patient', TODAY, {
          status: 'visited',
          patient_age: 28,
          patient_gender: 'Female',
          has_history: true,
          appointment_start: `${TODAY} 15:00:00`,
          appointment_end: `${TODAY} 15:30:00`,
        }),
        appointment('other-doctor', 'Other Doctor Appointment', TODAY, {
          doctor_id: OTHER_DOCTOR_ID,
        }),
        appointment('wrong-date', 'Wrong Date Appointment', '2026-11-18'),
        appointment('cancelled-row', 'Cancelled Appointment', TODAY, { status: 'cancelled' }),
      ],
    ],
    ['2026-11-16', [appointment('previous-day', 'Previous Day Patient', '2026-11-16')]],
    ['2026-11-18', [appointment('next-day', 'Next Day Patient', '2026-11-18')]],
  ]);

  await context.route('**/api/backend/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    requests.push({ path, date: url.searchParams.get('date') });
    let data: unknown;
    if (path.endsWith('/auth/login') && method === 'POST') {
      expect(request.postDataJSON().role).toBe('doctor');
      data = { ...identity, access_token: 'doctor-dashboard-test-token' };
    } else if (!request.headers().authorization) {
      await route.fulfill({
        status: 401,
        json: {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Sign in required.',
            request_id: 'req_dashboard_auth',
          },
        },
      });
      return;
    } else if (path.endsWith('/me')) data = identity;
    else if (path.endsWith('/profile'))
      data = {
        clinic: {
          name: 'Live Schedule Clinic',
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
            name: 'Dr. Asha Raman',
            qualification: 'MBBS, MD',
            user_id: identity.user.id,
            active: true,
          },
        ],
      };
    else if (path.endsWith('/appointments') && method === 'GET') {
      if (state.failAppointments) {
        await route.fulfill({
          status: 503,
          json: {
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Database temporarily unavailable.',
              request_id: 'req_dashboard_failure',
            },
          },
        });
        return;
      }
      expect(url.searchParams.get('status')).toBe('confirmed,visited');
      data = { appointments: rows.get(url.searchParams.get('date') ?? '') ?? [] };
    } else if (path.endsWith(`/doctors/${DOCTOR_ID}/schedules`)) data = { schedules };
    else if (path.endsWith('/hours')) data = { hours: clinicHours };
    else if (path.endsWith('/holidays'))
      data = {
        holidays: [
          {
            id: 'partial-self',
            holiday_date: '2026-11-19',
            reason: 'Clinic meeting',
            is_full_day: false,
            start_time: '13:00',
            end_time: '14:00',
            active: true,
            applies_to_clinic: false,
            doctor_ids: [DOCTOR_ID],
          },
          {
            id: 'full-self',
            holiday_date: '2026-11-20',
            reason: 'Conference leave',
            is_full_day: true,
            active: true,
            applies_to_clinic: false,
            doctor_ids: [DOCTOR_ID],
          },
          {
            id: 'other-doctor-leave',
            holiday_date: TODAY,
            reason: 'Another doctor leave',
            is_full_day: true,
            active: true,
            applies_to_clinic: false,
            doctor_ids: [OTHER_DOCTOR_ID],
          },
        ],
      };
    else if (path.endsWith('/doctor-services'))
      data = {
        doctor_services: [
          {
            id: 'self-general',
            doctor_id: DOCTOR_ID,
            clinic_service_id: 'general-service',
            consultation_fee_amount: '500',
            active: true,
          },
          {
            id: 'other-dermatology',
            doctor_id: OTHER_DOCTOR_ID,
            clinic_service_id: 'skin-service',
            consultation_fee_amount: '700',
            active: true,
          },
          {
            id: 'inactive-self',
            doctor_id: DOCTOR_ID,
            clinic_service_id: 'retired-service',
            consultation_fee_amount: '500',
            active: false,
          },
        ],
      };
    else if (path.endsWith('/services'))
      data = {
        services: [
          {
            id: 'general-service',
            service_name: 'General Consultation',
            service_key: 'general_consultation',
            active: true,
          },
          {
            id: 'skin-service',
            service_name: 'Dermatology Consultation',
            service_key: 'dermatology_consultation',
            active: true,
          },
          {
            id: 'retired-service',
            service_name: 'Retired Service',
            service_key: 'retired_service',
            active: true,
          },
        ],
      };
    else {
      unexpected.push(`${method} ${path}`);
      await route.fulfill({
        status: 404,
        json: {
          error: {
            code: 'NOT_FOUND',
            message: 'Unexpected dashboard test request.',
            request_id: 'req_dashboard_unexpected',
          },
        },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json: { data, meta: { request_id: 'req_doctor_dashboard_e2e', debug: null } },
    });
  });
  return { requests, unexpected, state };
}

async function signIn(page: Page) {
  await page.clock.setFixedTime(NOW);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Doctor', exact: true }).click();
  await page.getByPlaceholder('Email Address').fill('doctor@example.test');
  await page.getByPlaceholder('Password', { exact: true }).fill('doctor-test-password');
  await page.getByPlaceholder('Password', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/doctor\/?$/);
}

function summary(page: Page): Locator {
  return page.getByRole('region', { name: 'Appointment summary', exact: true });
}
function hours(page: Page): Locator {
  return page.getByRole('region', { name: 'Working hours', exact: true });
}
function stat(page: Page, label: string): Locator {
  return summary(page)
    .locator('dl > div')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) })
    .locator('dd');
}

test('saved personal partial and full holidays adjust the selected day working hours', async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const api = await mockDashboardApi(context);
  await signIn(page);
  await expect(summary(page)).toBeVisible();
  await page.getByLabel('Appointment date', { exact: true }).fill('2026-11-19');
  await expect(hours(page)).toContainText('12:15 PM – 01:00 PM');
  await expect(hours(page)).toContainText('02:00 PM – 05:45 PM');
  await expect(hours(page)).not.toContainText('12:15 PM – 05:45 PM');
  await page.getByLabel('Appointment date', { exact: true }).fill('2026-11-20');
  await expect(hours(page)).toContainText('Holiday: Conference leave');
  await expect(
    summary(page).getByRole('heading', { name: '0 appointments on Nov 20, 2026', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/No confirmed or visited appointments for Nov 20, 2026/),
  ).toBeVisible();
  expect(api.unexpected).toEqual([]);
});

test('failed appointment loads show an error instead of zero counts and can be retried', async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const api = await mockDashboardApi(context);
  api.state.failAppointments = true;
  await signIn(page);
  await expect(
    page.getByRole('alert').filter({ hasText: 'The service is temporarily unavailable.' }),
  ).toBeVisible();
  await expect(summary(page)).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: '0 appointments today', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/No confirmed or visited appointments for today/)).toHaveCount(0);
  api.state.failAppointments = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(
    summary(page).getByRole('heading', { name: '2 appointments today', exact: true }),
  ).toBeVisible();
  expect(api.unexpected).toEqual([]);
});

test('mobile date controls and saved hours remain within the viewport', async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = await mockDashboardApi(context);
  await signIn(page);
  await expect(summary(page)).toBeVisible();
  await page.getByLabel('Appointment date', { exact: true }).fill('2026-11-19');
  await expect(hours(page)).toContainText('02:00 PM – 05:45 PM');
  await expect(page.getByRole('button', { name: 'Previous day', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next day', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '/tmp/vaidhyaa-doctor-dashboard-mobile.png', fullPage: true });
  expect(api.unexpected).toEqual([]);
});

test('clinic-local Today displays saved weekday hours, assigned services and real appointment data only', async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const api = await mockDashboardApi(context);
  await signIn(page);
  const doctorSidebar = page.getByRole('complementary');
  await expect(
    doctorSidebar.getByText('Service: General Consultation', { exact: true }),
  ).toBeVisible();
  await expect(doctorSidebar).not.toContainText(/Dermatology Consultation|Retired Service/);
  await expect(page.getByLabel('Appointment date', { exact: true })).toHaveValue(TODAY);
  expect(await page.evaluate(() => new Date().getDate())).toBe(16);
  await expect(page.getByRole('heading', { name: "Today's Queue", exact: true })).toBeVisible();
  await expect(page.getByText('Tuesday, November 17, 2026', { exact: true })).toBeVisible();
  await expect(
    summary(page).getByRole('heading', { name: '2 appointments today', exact: true }),
  ).toBeVisible();
  await expect(hours(page)).toContainText('01:20 PM – 04:40 PM');
  await expect(summary(page)).toContainText('General Consultation');
  await expect(summary(page)).not.toContainText(
    /Orthopaedic|Morning 9AM|Evening 5PM|Dermatology|Retired Service/,
  );
  await expect(stat(page, 'Confirmed')).toHaveText('1');
  await expect(stat(page, 'Visited')).toHaveText('1');
  await expect(stat(page, 'Total')).toHaveText('2');
  await expect(page.getByText('Other Doctor Appointment', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Wrong Date Appointment', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Cancelled Appointment', { exact: true })).toHaveCount(0);
  const arun = page.getByRole('article').filter({ hasText: 'Arun Kumar' });
  await expect(arun).toBeVisible();
  await expect(arun).not.toContainText(/52 yrs|Male|Knee pain|Osteoarthritis/);
  await expect(
    page.getByRole('article').filter({ hasText: 'Database Visited Patient' }),
  ).toContainText('28 yrs · Female');
  await arun.getByRole('button', { name: /Start Consultation/ }).click();
  await expect(page.getByText('No clinical history recorded.', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Initial knee pain consultation|Knee swelling after fall|Osteoarthritis Grade/),
  ).toHaveCount(0);
  await expect(stat(page, 'Confirmed')).toHaveText('1');
  await page.screenshot({ path: '/tmp/vaidhyaa-doctor-dashboard-desktop.png', fullPage: true });
  expect(
    api.requests
      .filter((row) => row.path.endsWith('/appointments'))
      .every((row) => row.date === TODAY),
  ).toBe(true);
  expect(api.unexpected).toEqual([]);
});

test('date picker, previous/next and Today request the selected day and update queue titles', async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const api = await mockDashboardApi(context);
  await signIn(page);
  await expect(summary(page)).toBeVisible();
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(page.getByLabel('Appointment date', { exact: true })).toHaveValue('2026-11-18');
  await expect(page.getByRole('heading', { name: 'Appointment Queue', exact: true })).toBeVisible();
  await expect(
    summary(page).getByRole('heading', { name: '1 appointment on Nov 18, 2026', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Next Day Patient', { exact: true })).toBeVisible();
  await expect(page.getByText('Arun Kumar', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  await expect(
    summary(page).getByRole('heading', { name: '2 appointments today', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  await expect(page.getByText('Previous Day Patient', { exact: true })).toBeVisible();
  await expect(hours(page)).toContainText('09:00 AM – 11:55 AM');
  await page.getByLabel('Appointment date', { exact: true }).fill('2026-11-18');
  await expect(page.getByText('Next Day Patient', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByLabel('Appointment date', { exact: true })).toHaveValue(TODAY);
  await expect(page.getByRole('heading', { name: "Today's Queue", exact: true })).toBeVisible();
  await expect(
    summary(page).getByRole('heading', { name: '2 appointments today', exact: true }),
  ).toBeVisible();
  expect(
    api.requests.filter((row) => row.path.endsWith('/appointments')).map((row) => row.date),
  ).toEqual([TODAY, '2026-11-18', TODAY, '2026-11-16', '2026-11-18', TODAY]);
  expect(api.unexpected).toEqual([]);
});
