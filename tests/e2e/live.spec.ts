import { test, expect } from '@playwright/test';
const id = '90000000-0000-4000-8000-000000000001';
const turnId = '90000000-0000-4000-8000-000000000002';
const makeSession = () => ({
  id,
  topic: 'A gentle introduction',
  mode: 'Free conversation',
  difficulty: 'Comfortable',
  duration: 10,
  input_mode: 'hands-free',
  created_at: new Date().toISOString(),
  ended_at: null,
  status: 'active',
  report_status: 'pending',
});

test('live microphone denial gives recovery instructions', async ({ page }, testInfo) => {
  await page.route(`**/api/sessions/${id}`, (route) =>
    route.fulfill({ json: { session: makeSession(), turns: [], report: null } }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        throw new DOMException('Permission denied', 'NotAllowedError');
      },
    });
  });
  await page.goto(`/practice/${id}`);
  await page.getByRole('button', { name: 'Connect microphone', exact: true }).click();
  await expect(page.locator('.alert[role="alert"]')).toContainText('site permissions');
  await expect(page.getByRole('button', { name: 'Try microphone again' })).toBeVisible();
  await page.screenshot({ path: `test-results/live-${testInfo.project.name}.png`, fullPage: true });
});
test('unsent transcript recovers, syncs, and survives refresh', async ({ page }) => {
  let serverTurns: { id: string; role: string; text: string; sequence: number }[] = [];
  await page.route(`**/api/sessions/${id}`, (route) =>
    route.fulfill({ json: { session: makeSession(), turns: serverTurns, report: null } }),
  );
  await page.route(`**/api/sessions/${id}/turns`, async (route) => {
    serverTurns = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/');
  await page.evaluate(
    ({ id, turnId }) =>
      sessionStorage.setItem(
        `speakbetter:undefined:${id}`,
        JSON.stringify([
          { id: turnId, role: 'user', text: 'Yesterday I went to a cafe.', sequence: 0 },
        ]),
      ),
    { id, turnId },
  );
  await page.goto(`/practice/${id}`);
  await expect(page.getByText('Yesterday I went to a cafe.', { exact: true })).toBeVisible();
  await expect.poll(() => serverTurns.length).toBe(1);
  await page.evaluate(({ id }) => sessionStorage.removeItem(`speakbetter:undefined:${id}`), { id });
  await page.reload();
  await expect(page.getByText('Yesterday I went to a cafe.', { exact: true })).toBeVisible();
});
