import { expect, test, type Locator, type Page } from '@playwright/test';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const ADMIN_ID = '00000000-0000-0000-0000-000000000102';
const DOCTOR_IDS = [
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000202',
  '00000000-0000-0000-0000-000000000203',
  '00000000-0000-0000-0000-000000000204',
] as const;
const SERVICE_IDS = [
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000302',
  '00000000-0000-0000-0000-000000000303',
  '00000000-0000-0000-0000-000000000304',
] as const;

const doctors = [
  {
    id: DOCTOR_IDS[0],
    name: 'Dr. Meenakshi Subramanian',
    qualification: 'MD, Internal Medicine',
    user_id: null,
    active: true,
  },
  {
    id: DOCTOR_IDS[1],
    name: 'Dr. Nishanth',
    qualification: 'MS',
    user_id: null,
    active: true,
  },
  {
    id: DOCTOR_IDS[2],
    name: 'Dr. Prem Kumar',
    qualification: 'MS, Cardiology',
    user_id: null,
    active: true,
  },
  {
    id: DOCTOR_IDS[3],
    name: 'Dr. Karthikeyan',
    qualification: 'MBBS',
    user_id: null,
    active: true,
  },
];

const services = [
  ['general_consultation', 'General Consultation'],
  ['paediatric_consultation', 'Paediatric Consultation'],
  ['cardiology_consultation', 'Cardiology Consultation'],
  ['ophthalmology_consultation', 'Ophthalmology Consultation'],
].map(([serviceKey, serviceName], index) => ({
  id: SERVICE_IDS[index]!,
  service_key: serviceKey,
  service_name: serviceName,
  active: true,
}));

const doctorServices = DOCTOR_IDS.map((doctorId, index) => ({
  id: `00000000-0000-0000-0000-00000000040${index + 1}`,
  doctor_id: doctorId,
  clinic_service_id: SERVICE_IDS[index]!,
  consultation_fee_amount: `${500 + index * 250}.00`,
  active: true,
}));

function success(data: unknown) {
  return {
    data,
    meta: { request_id: 'clinic-responsive-e2e', debug: null },
  };
}

async function mockClinicSetupApi(page: Page) {
  await page.addInitScript(
    ({ clinicId, adminId }) => {
      window.localStorage.setItem(
        'vaidya_dev_auth',
        JSON.stringify({
          userId: adminId,
          clinicId,
          role: 'clinic_admin',
        }),
      );
    },
    { clinicId: CLINIC_ID, adminId: ADMIN_ID },
  );

  await page.route('**/api/backend/**', async (route) => {
    const request = route.request();
    const apiPath = new URL(request.url()).pathname.replace('/api/backend', '');
    let data: unknown;

    if (apiPath === '/v1/me') {
      data = {
        user: {
          id: ADMIN_ID,
          name: 'Responsive Clinic Admin',
          email: 'admin@example.test',
          phone: '+919876543210',
          platform_role: null,
          active: true,
        },
        clinics: [
          {
            clinic_id: CLINIC_ID,
            role: 'clinic_admin',
            doctor_id: null,
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
    } else if (apiPath.endsWith('/settings')) {
      data = {
        settings: {
          clinic_id: CLINIC_ID,
          agent_enabled: true,
          answering_mode: 'ai_first',
          fallback_phone: null,
          overflow_after_rings: 5,
          booking_mode: 'request',
          max_concurrent_calls: 2,
          recording_retention_days: 30,
          transcript_retention_days: 30,
          notify_staff_on_pending_appointment: true,
          pending_appointment_notification_channel: 'in_app',
          allow_doctor_service_edit: true,
          allow_patient_auto_cancel: false,
        },
      };
    } else if (apiPath.endsWith('/doctor-services')) {
      data = { doctor_services: doctorServices };
    } else if (apiPath.endsWith('/doctor-schedules')) {
      data = {
        schedules: [
          {
            id: '00000000-0000-0000-0000-000000000501',
            doctor_id: DOCTOR_IDS[0],
            day_of_week: 1,
            start_time: '09:00',
            end_time: '17:00',
            active: true,
          },
        ],
      };
    } else if (apiPath.endsWith('/booking-rules')) {
      data = { booking_rules: [] };
    } else if (apiPath.endsWith('/doctors')) {
      data = { doctors };
    } else if (apiPath.endsWith('/services')) {
      data = { services };
    } else if (apiPath.endsWith('/hours')) {
      data = {
        hours: [
          {
            id: '00000000-0000-0000-0000-000000000601',
            day_of_week: 1,
            start_time: '09:00',
            end_time: '18:00',
            active: true,
          },
        ],
      };
    } else if (apiPath.endsWith('/holidays')) {
      data = { holidays: [] };
    } else if (apiPath.endsWith('/users')) {
      data = {
        clinic_login_number: '1003',
        users: [
          {
            id: '00000000-0000-0000-0000-000000000701',
            clinic_id: CLINIC_ID,
            user_id: ADMIN_ID,
            role: 'clinic_admin',
            doctor_id: null,
            active: true,
            user: {
              id: ADMIN_ID,
              name: 'Responsive Clinic Admin',
              email: 'admin@example.test',
              phone: '+919876543210',
              username: 'responsive.admin.1003',
              active: true,
            },
          },
        ],
      };
    } else {
      throw new Error(`Unhandled clinic setup request: ${request.method()} ${apiPath}`);
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

async function expectNoPageOverflow(page: Page) {
  const measurements = await page.evaluate(() => {
    const main = document.querySelector('main');
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      mainClientWidth: main?.clientWidth ?? 0,
      mainScrollWidth: main?.scrollWidth ?? 0,
    };
  });

  expect(measurements.documentWidth).toBeLessThanOrEqual(measurements.viewport + 1);
  expect(measurements.bodyWidth).toBeLessThanOrEqual(measurements.viewport + 1);
  expect(measurements.mainScrollWidth).toBeLessThanOrEqual(measurements.mainClientWidth + 1);
}

async function expectControlsContained(container: Locator) {
  const result = await container.evaluate((element) => {
    const containerRect = element.getBoundingClientRect();
    const controls = Array.from(
      element.querySelectorAll<HTMLElement>('input, select, button'),
    ).filter((control) => {
      const style = window.getComputedStyle(control);
      const rect = control.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0;
    });
    const overflow = controls
      .map((control) => {
        const rect = control.getBoundingClientRect();
        return {
          label:
            control.getAttribute('aria-label') ?? control.textContent?.trim() ?? control.tagName,
          left: rect.left,
          right: rect.right,
        };
      })
      .filter(
        (control) =>
          control.left < containerRect.left - 1 || control.right > containerRect.right + 1,
      );

    return { overflow };
  });

  expect(result.overflow).toEqual([]);
}

test('clinic setup cards and doctor editor stay aligned across supported screen sizes', async ({
  page,
}) => {
  await mockClinicSetupApi(page);
  await page.goto('/clinic-setup');

  const doctorCard = page.getByTestId('doctor-management-card');
  await expect(doctorCard).toBeVisible();

  const viewports = [320, 390, 640, 768, 1024, 1148, 1280, 1440, 1920];
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await settleResponsiveLayout(page);
    await expectNoPageOverflow(page);
    await expectControlsContained(doctorCard);

    await doctorCard.getByRole('button', { name: 'Edit' }).click();
    await expect(doctorCard.getByTestId('doctor-editor-row')).toHaveCount(doctors.length);
    await settleResponsiveLayout(page);
    await expectNoPageOverflow(page);
    await expectControlsContained(doctorCard);

    await doctorCard.getByRole('button', { name: 'Cancel' }).click();
    await expect(doctorCard.getByRole('button', { name: 'Edit' })).toBeVisible();
  }
});

test('clinic and doctor schedule editors stack their controls without page overflow', async ({
  page,
}) => {
  await mockClinicSetupApi(page);
  await page.goto('/clinic-setup');

  for (const width of [320, 390, 640, 1024, 1148, 1440]) {
    await page.setViewportSize({ width, height: 900 });

    for (const testId of ['clinic-hours-card', 'doctor-schedule-card']) {
      const card = page.getByTestId(testId);
      await expect(card).toBeVisible();
      await card.getByRole('button', { name: 'Edit' }).click();
      await settleResponsiveLayout(page);
      await expectNoPageOverflow(page);
      await expectControlsContained(card);
      await card.getByRole('button', { name: 'Cancel' }).click();
    }
  }
});
