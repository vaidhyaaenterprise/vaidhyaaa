import { expect, test, type Page } from '@playwright/test';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const ADMIN_ID = '00000000-0000-0000-0000-000000000102';

async function mockCallInbox(page: Page) {
  await page.addInitScript(
    ({ clinicId, userId }) => {
      localStorage.setItem(
        'vaidya_dev_auth',
        JSON.stringify({
          clinicId,
          userId,
          role: 'clinic_admin',
        }),
      );
    },
    { clinicId: CLINIC_ID, userId: ADMIN_ID },
  );
  await page.route('**/api/backend/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path.endsWith('/me')) {
      data = {
        user: {
          id: ADMIN_ID,
          name: 'Clinic Admin',
          email: 'admin@example.test',
          phone: '9876543210',
          platform_role: null,
          active: true,
        },
        clinics: [{ clinic_id: CLINIC_ID, role: 'clinic_admin', doctor_id: null, active: true }],
      };
    } else if (path.endsWith('/profile')) {
      data = {
        clinic: {
          name: 'Call Inbox Test Clinic',
          clinic_unique_number: 1003,
          primary_phone: '9876543210',
          address_line1: 'Clinic Street',
          address_line2: null,
          city: 'Chennai',
          state: 'Tamil Nadu',
          postal_code: '600097',
          country: 'India',
          timezone: 'Asia/Kolkata',
        },
      };
    } else if (path.endsWith('/call-inbox')) {
      data = {
        items: Array.from({ length: 30 }, (_, index) => ({
          id: `call-${index}`,
          patient_name: `Patient ${index}`,
          patient_phone: '9876543210',
          occurred_at: '2026-10-24T16:00:00Z',
          duration_seconds: 60,
          summary:
            index === 29
              ? 'Patient booked a consultation and asked about clinic facilities. '.repeat(70)
              : `Consultation summary ${index}.`,
          outcome: 'appointment_booked',
          appointment_start: '2026-10-28 09:30:00',
        })),
        next_cursor: null,
      };
    } else {
      throw new Error(`Unexpected API request: ${path}`);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data,
        meta: { request_id: 'call-details-e2e', debug: null },
      }),
    });
  });
}

for (const width of [1440, 390]) {
  test(`call details stay visible after scrolling and preserve list position at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await mockCallInbox(page);
    await page.goto('/call-inbox');
    const lowerCall = page.getByRole('button', { name: /View call details for Patient 28,/ });
    await lowerCall.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    expect(scrollBefore).toBeGreaterThan(1000);
    await lowerCall.click();

    const panel = page.getByRole('dialog', { name: 'Call details' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Close call details' })).toBeFocused();
    await expect(panel.getByText('Patient 28', { exact: true })).toBeVisible();
    await expect(panel.getByText('28 Oct 2026 at 9:30 AM')).toBeVisible();
    const bounds = await panel.boundingBox();
    expect(bounds?.y).toBe(0);
    expect(bounds?.height).toBeLessThanOrEqual(800);
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await expect(panel).not.toBeVisible();
    await expect(lowerCall).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    // Long details scroll independently, leaving the close control visible.
    await page.getByRole('button', { name: /View call details for Patient 29,/ }).click();
    const detailsBody = panel.locator('> div');
    const bodySizes = await detailsBody.evaluate((element) => ({
      client: element.clientHeight,
      scroll: element.scrollHeight,
    }));
    expect(bodySizes.scroll).toBeGreaterThan(bodySizes.client);
    await detailsBody.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(panel.getByText('28 Oct 2026 at 9:30 AM')).toBeInViewport();
    await expect(panel.getByRole('button', { name: 'Close call details' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({ path: `/private/tmp/vaidhyaa-call-details-${width}.png` });
    await panel.getByRole('button', { name: 'Close call details' }).click();
    await expect(panel).not.toBeVisible();
  });
}
