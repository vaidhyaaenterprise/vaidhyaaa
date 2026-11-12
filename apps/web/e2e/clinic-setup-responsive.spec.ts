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

    const fee = doctorCard.getByRole('textbox', { name: `Fee for ${doctors[0]!.name}` });
    await fee.fill('');
    await expect(fee).toHaveValue('');
    await fee.pressSequentially('e+-2.5');
    await expect(fee).toHaveValue('25');
    await fee.fill('750');
    await expect(fee).toHaveValue('750');
    const service = doctorCard.getByRole('combobox', { name: `Service for ${doctors[0]!.name}` });
    const selectStyles = await service.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        appearance: style.appearance,
        paddingRight: Number.parseFloat(style.paddingRight),
        arrow: style.backgroundImage,
      };
    });
    expect(selectStyles.appearance).toBe('none');
    expect(selectStyles.paddingRight).toBeGreaterThanOrEqual(40);
    expect(selectStyles.arrow).toContain('svg');
    await expect(doctorCard.getByRole('button', { name: `Remove ${doctors[0]!.name}` })).toHaveText(
      '',
    );
    if (width === 1440)
      await page.screenshot({ path: '/private/tmp/vaidhyaa-doctor-editor.png', fullPage: true });

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

test('shows clear clinic conflicts and restricts manual patient phones to ten digits', async ({
  page,
}) => {
  await mockClinicSetupApi(page);
  await page.route('**/api/backend/v1/clinics/*/hours', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    await route.fulfill({
      status: 409,
      json: {
        error: {
          code: 'CONFLICTING_APPOINTMENTS',
          message: 'Review the schedules before saving.',
          request_id: 'conflict-ui-check',
          details: {
            conflicts: [
              {
                reason: 'doctor_schedule_outside_clinic_hours',
                doctor_schedule: {
                  doctor_name: 'Dr. Meenakshi Subramanian',
                  day_of_week: 1,
                  start_time: '09:00',
                  end_time: '17:00',
                },
              },
              {
                reason: 'outside_clinic_hours',
                appointment: {
                  patient_name: 'Kamal',
                  appointment_start: '2026-10-20 09:30:00',
                  appointment_end: '2026-10-20 09:45:00',
                  doctor_name: 'Dr. Meenakshi Subramanian',
                  service_name: 'General Consultation',
                  status: 'confirmed',
                },
              },
            ],
          },
        },
      },
    });
  });
  await page.goto('/clinic-setup');
  const clinicHours = page.getByTestId('clinic-hours-card');
  await clinicHours.getByRole('button', { name: 'Edit' }).click();
  await clinicHours.getByRole('button', { name: 'Save', exact: true }).click();
  const panel = clinicHours.getByRole('alert', { name: 'Schedule conflicts' });
  await expect(panel).toContainText(
    'Kamal has booked an appointment on 20 Oct 2026 at 9:30 AM with Dr. Meenakshi Subramanian.',
  );
  await expect(panel).toContainText('Holiday setup');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expectNoPageOverflow(page);
    await panel.screenshot({ path: `/private/tmp/vaidhyaa-schedule-conflict-${width}.png` });
  }

  await page.route('**/api/backend/v1/clinics/*/appointments**', async (route) => {
    await route.fulfill({
      json: success({ appointments: [], action_requests: [], activities: [], slots: [] }),
    });
  });
  await page.goto('/appointments');
  await page.getByRole('button', { name: 'New appointment' }).click();
  const phone = page.getByRole('textbox', { name: 'Patient phone *' });
  await expect(phone).toBeVisible();
  await phone.pressSequentially('98765abc43210+');
  await expect(phone).toHaveValue('9876543210');
  await phone.press('5');
  await expect(phone).toHaveValue('9876543210');
  await phone.fill('12345678');
  expect(await phone.evaluate((input: HTMLInputElement) => input.validity.tooShort)).toBe(true);
  await phone.fill('9876543210');
  expect(await phone.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true);
});

test('holiday date edits clear old conflicts and saved holidays can be removed', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-19T12:00:00Z'));
  await mockClinicSetupApi(page);
  const holiday = {
    id: 'holiday-1',
    holiday_date: '2026-10-20',
    reason: 'Dasara',
    active: true,
    is_full_day: true,
    applies_to_clinic: true,
    doctor_ids: [],
  };
  let attempts = 0;
  await page.route(/\/api\/backend\/v1\/clinics\/[^/]+\/holidays(?:\/[^/?]+)?$/, async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: success({ holidays: [holiday] }) });
    const patch = route.request().postDataJSON();
    if (patch.active === false)
      return route.fulfill({ json: success({ holiday: { ...holiday, active: false } }) });
    attempts++;
    if (attempts === 1)
      return route.fulfill({
        status: 409,
        json: {
          error: {
            code: 'CONFLICTING_APPOINTMENTS',
            message: 'Holiday conflicts with an appointment.',
            request_id: 'holiday-conflict',
            details: {
              conflicts: [
                {
                  reason: 'active_appointment_on_holiday',
                  appointment: {
                    patient_name: 'Kamal',
                    appointment_start: '2026-10-20 09:30:00',
                    appointment_end: '2026-10-20 09:45:00',
                    doctor_name: 'Dr. Meenakshi Subramanian',
                    service_name: 'General Consultation',
                    status: 'confirmed',
                  },
                },
              ],
            },
          },
        },
      });
    expect(patch.holiday_date).toBe('2026-10-21');
    return route.fulfill({ json: success({ holiday: { ...holiday, ...patch } }) });
  });
  await page.goto('/clinic-setup');
  const card = page
    .locator('div.rounded-2xl')
    .filter({ has: page.getByRole('heading', { name: 'Holiday setup', exact: true }) })
    .last();
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await card.getByLabel('Holiday reason').fill('Updated Dasara');
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card.getByRole('alert')).toContainText('Kamal has booked an appointment');
  await expect(card.getByRole('button', { name: 'Recheck and save' })).toBeEnabled();
  await card.getByLabel('Holiday date').fill('2026-10-21');
  await expect(card.getByRole('alert')).toHaveCount(0);
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card.getByRole('status')).toContainText('Holidays saved');
  await card.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(card).toContainText('No current or upcoming holidays configured.');
});

test('shared doctor hours reject overlaps and save every active doctor through the bulk route', async ({
  page,
}) => {
  await mockClinicSetupApi(page);
  let bulkSaves = 0;
  await page.route('**/api/backend/v1/clinics/*/doctor-schedules', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    bulkSaves++;
    const { windows } = route.request().postDataJSON();
    await route.fulfill({
      json: success({
        schedules: doctors.flatMap((doctor) =>
          windows.map((window: object, index: number) => ({
            ...window,
            id: `${doctor.id}-${index}`,
            doctor_id: doctor.id,
          })),
        ),
      }),
    });
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/clinic-setup');
  const card = page.getByTestId('doctor-schedule-card');
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(card).toContainText(
    'Saving replaces the existing weekly schedules of all 4 active doctors',
  );
  await card.getByRole('button', { name: '+ Add slot', exact: true }).first().click();
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card).toContainText('Working hours for the same doctor must not overlap');
  expect(bulkSaves).toBe(0);
  const inputs = card.locator('input[type="time"]');
  await inputs.nth(2).fill('17:00');
  await inputs.nth(3).fill('18:00');
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card.getByRole('status')).toContainText('Working hours saved');
  expect(bulkSaves).toBe(1);
  await expectNoPageOverflow(page);
  await expect(card.getByRole('heading', { name: 'Dr. Karthikeyan', exact: true })).toBeVisible();
});

test('clinic details require every field and enforce phone and PIN formats', async ({ page }) => {
  await mockClinicSetupApi(page);
  let saved = 0;
  await page.route('**/api/backend/v1/clinics/*/profile', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const details = route.request().postDataJSON();
    expect(details.primary_phone).toBe('9876543210');
    expect(details.postal_code).toBe('600097');
    expect(details.address_line2).toBe('Near the park');
    saved++;
    await route.fulfill({
      json: success({
        clinic: { ...details, clinic_unique_number: 1003, timezone: 'Asia/Kolkata' },
      }),
    });
  });
  await page.goto('/clinic-setup');
  await page.getByRole('button', { name: 'Edit clinic details' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit clinic details' });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toContainText('Address line 2 is required.');
  expect(saved).toBe(0);
  await dialog.getByLabel('Address line 2').fill('Near the park');
  const phone = dialog.getByLabel('Phone number');
  await phone.fill('');
  await phone.pressSequentially('98765abc43210+');
  await expect(phone).toHaveValue('9876543210');
  await phone.press('1');
  await expect(phone).toHaveValue('9876543210');
  const pin = dialog.getByLabel('Postal code');
  await pin.fill('000097');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toContainText('Enter a valid 6-digit PIN code that does not start with 0.');
  expect(saved).toBe(0);
  await pin.fill('600097');
  await pin.pressSequentially('e+8');
  await expect(pin).toHaveValue('600097');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(saved).toBe(1);
});

test('booking rule fields behave like fees and cannot save a duration below fifteen minutes', async ({
  page,
}) => {
  await mockClinicSetupApi(page);
  await page.route('**/api/backend/v1/clinics/*/booking-rules', async (route) =>
    route.fulfill({
      json: success({
        booking_rules: [
          {
            id: '00000000-0000-0000-0000-000000000801',
            doctor_id: DOCTOR_IDS[0],
            clinic_service_id: SERVICE_IDS[0],
            slot_duration_minutes: 30,
            capacity_per_slot: 3,
            booking_horizon_days: 45,
            active: true,
            version: 1,
          },
        ],
      }),
    }),
  );
  await page.goto('/clinic-setup');
  const card = page
    .locator('div.rounded-2xl')
    .filter({ has: page.getByRole('heading', { name: 'Booking rules', exact: true }) })
    .last();
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  for (const [label, value] of [
    ['Slot duration (minutes)', '30'],
    ['Capacity per slot', '3'],
  ]) {
    const input = card.getByLabel(label!);
    await expect(input).toHaveAttribute('type', 'text');
    await input.fill('');
    await expect(input).toHaveValue('');
    await input.pressSequentially('e+-.a');
    await expect(input).toHaveValue('');
    await input.pressSequentially(value!);
    await expect(input).toHaveValue(value!);
  }
  await card.getByLabel('Slot duration (minutes)').fill('5');
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card).toContainText('Slot duration must be a number between 15 and 120.');
});
