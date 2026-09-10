import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '../apps/web/node_modules/@playwright/test/index.mjs';

const outDir = join(process.cwd(), 'frontend-reflection');
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });

await context.route('http://localhost:3000/v1/me', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: {
        user: {
          id: '00000000-0000-0000-0000-000000000102',
          name: 'Clinic Admin',
          email: 'admin@sri-murugan.local',
          phone: null,
          platform_role: null,
          active: true,
        },
        clinics: [
          {
            clinic_id: '00000000-0000-0000-0000-000000000001',
            role: 'clinic_admin',
            doctor_id: null,
            active: true,
          },
        ],
      },
      meta: { request_id: 'req_mock_reflection', debug: null },
    }),
  });
});

const page = await context.newPage();
await page.addInitScript(() => {
  window.localStorage.setItem(
    'vaidya_dev_auth',
    JSON.stringify({
      userId: '00000000-0000-0000-0000-000000000102',
      clinicId: '00000000-0000-0000-0000-000000000001',
      role: 'clinic_admin',
    }),
  );
});

const routes = [
  ['home', 'http://localhost:3001/'],
  ['clinic-setup', 'http://localhost:3001/clinic-setup'],
  ['appointments', 'http://localhost:3001/appointments'],
  ['knowledge-base', 'http://localhost:3001/knowledge-base'],
  ['settings', 'http://localhost:3001/settings'],
  ['platform-jobs', 'http://localhost:3001/internal/platform/jobs'],
];

const results = [];
for (const [name, url] of routes) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
  await page.locator('aside').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: 10000 });
  const file = join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const title = await page.locator('h1').first().textContent().catch(() => null);
  results.push({ name, url, file, title });
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
