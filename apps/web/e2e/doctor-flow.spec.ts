import { test, expect } from '@playwright/test';

test('doctor login, dashboard, and logout flow', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByText('Vaidya portal')).toBeVisible();

  await page.getByRole('button', { name: 'Doctor', exact: true }).click();
  await page.getByRole('button', { name: /Sign in as Doctor/i }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: "Today's Queue" })).toBeVisible();
  await expect(page.getByText('Doctor Portal')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analytics' })).toBeVisible();

  await page.getByRole('button', { name: 'Analytics' }).click();
  await expect(page.getByRole('heading', { name: 'Patient Analytics' })).toBeVisible();

  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Vaidya portal')).toBeVisible();
});
