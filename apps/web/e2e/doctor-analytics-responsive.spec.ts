import { expect, test, type Page } from '@playwright/test';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const DOCTOR_USER_ID = '00000000-0000-0000-0000-000000000101';
const DOCTOR_ID = '00000000-0000-0000-0000-000000000201';

function success(data: unknown) {
  return {
    data,
    meta: { request_id: 'doctor-analytics-responsive-e2e', debug: null },
  };
}

async function mockDoctorPortalApi(page: Page) {
  await page.addInitScript(
    ({ clinicId, doctorId, userId }) => {
      window.localStorage.setItem(
        'vaidya_shared_auth_session_v1',
        JSON.stringify({
          version: 1,
          token: 'doctor-analytics-test-token',
          profile: {
            userId,
            clinicId,
            doctorId,
            role: 'doctor',
          },
        }),
      );
    },
    { clinicId: CLINIC_ID, doctorId: DOCTOR_ID, userId: DOCTOR_USER_ID },
  );

  await page.route('**/api/backend/**', async (route) => {
    const apiPath = new URL(route.request().url()).pathname.replace('/api/backend', '');
    let data: unknown;

    if (apiPath === '/v1/me') {
      data = {
        user: {
          id: DOCTOR_USER_ID,
          name: 'Dr. Responsive Test',
          email: 'doctor@example.test',
          phone: '+919876543210',
          platform_role: null,
          active: true,
        },
        clinics: [
          {
            clinic_id: CLINIC_ID,
            role: 'doctor',
            doctor_id: DOCTOR_ID,
            active: true,
          },
        ],
      };
    } else if (apiPath.endsWith('/profile')) {
      data = {
        clinic: {
          name: 'Responsive Care Clinic',
          clinic_unique_number: 1003,
          primary_phone: '9876543210',
          address_line1: 'VPG Avenue 3rd Street',
          address_line2: null,
          city: 'Chennai',
          state: 'Tamil Nadu',
          postal_code: '600097',
          country: 'India',
          timezone: 'Asia/Kolkata',
        },
      };
    } else if (apiPath.endsWith('/appointments/analytics')) {
      data = {
        analytics: {
          stats: {
            confirmed_this_month: 34,
            new_confirmed_this_month: 14,
            follow_up_confirmed_this_month: 20,
            average_confirmed_per_day: 2,
          },
          trends: {
            daily: [
              {
                period_start: '2026-11-17',
                label: '17 Nov',
                total: 5,
                new_patients: 2,
                follow_ups: 3,
              },
            ],
            weekly: [],
            monthly: [],
          },
          top_conditions: [
            { condition: 'Back pain', count: 8 },
            { condition: 'Knee pain', count: 6 },
          ],
          age_groups: [
            { label: '19–30', count: 6 },
            { label: '31–45', count: 12 },
          ],
          monthly_summary: ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'].map((label, index) => ({
            period_start: `2026-${String(index + 6).padStart(2, '0')}-01`,
            label: `${label} 2026`,
            total: index + 3,
            new_patients: index + 1,
            follow_ups: 2,
            average_per_day: 1,
          })),
        },
      };
    } else if (apiPath.endsWith('/doctors')) {
      data = {
        doctors: [
          {
            id: DOCTOR_ID,
            name: 'Dr. Responsive Test',
            qualification: 'MBBS, MD',
            active: true,
            user_id: DOCTOR_USER_ID,
          },
        ],
      };
    } else if (apiPath.endsWith('/doctor-services')) {
      data = { doctor_services: [] };
    } else if (apiPath.endsWith('/services')) {
      data = { services: [] };
    } else if (apiPath.includes('/appointments')) {
      data = { appointments: [] };
    } else {
      throw new Error(`Unhandled doctor portal request: ${route.request().method()} ${apiPath}`);
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(success(data)),
    });
  });
}

async function settleResponsiveLayout(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test('doctor analytics cards remain contained at desktop breakpoints', async ({ page }) => {
  await mockDoctorPortalApi(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/doctor/analytics');

  const breakdown = page.getByTestId('doctor-analytics-breakdown');
  await expect(breakdown).toBeVisible();
  const totalCard = page.getByText('Total This Month', { exact: true }).locator('..');
  await expect(totalCard).toContainText('34');
  await expect(page.getByText('Back pain', { exact: true })).toBeVisible();
  await expect(page.getByText('Visit Type', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(7);

  for (const width of [1024, 1280, 1440, 1536, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await settleResponsiveLayout(page);

    const measurements = await page.evaluate(() => {
      const main = document.querySelector('main');
      const grid = document.querySelector<HTMLElement>(
        '[data-testid="doctor-analytics-breakdown"]',
      );
      const cards = grid ? Array.from(grid.children) : [];

      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        mainClientWidth: main?.clientWidth ?? 0,
        mainScrollWidth: main?.scrollWidth ?? 0,
        cardOverflow: cards.map((card) => ({
          clientWidth: card.clientWidth,
          scrollWidth: card.scrollWidth,
        })),
      };
    });

    expect(measurements.documentWidth).toBeLessThanOrEqual(measurements.viewportWidth + 1);
    expect(measurements.mainScrollWidth).toBeLessThanOrEqual(measurements.mainClientWidth + 1);
    expect(measurements.cardOverflow).toHaveLength(2);
    for (const card of measurements.cardOverflow) {
      expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);
    }
  }
});
