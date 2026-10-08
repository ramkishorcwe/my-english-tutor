import { test, expect } from '@playwright/test';

test('preview dashboard is labeled, responsive, and links to practice', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Hello, there. Let’s find your voice.' }),
  ).toBeVisible();
  await expect(page.getByText('PREVIEW', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `test-results/overview-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Start a conversation', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'A conversation for every kind of day.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Make it your own' }).click();
  await expect(page.getByRole('button', { name: 'Let’s start talking' })).toBeDisabled();
  await page.getByPlaceholder('e.g. Ordering lunch at a cafe in London').fill('A trip to London');
  await page.getByRole('button', { name: 'Let’s start talking' }).click();
  await expect(page.getByRole('heading', { name: 'Make room for your voice.' })).toBeVisible();
  expect(errors).toEqual([]);
});
test('sample report has traceable evidence and honest unavailable measurements', async ({
  page,
}, testInfo) => {
  await page.goto('/report/demo');
  await expect(page.getByText('Sample report · Fictional conversation')).toBeVisible();
  await expect(
    page.getByText('Yesterday I go to a new cafe before work.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Speaking delivery: unavailable.', { exact: false })).toBeVisible();
  await page.getByText('Your conversation transcript', { exact: true }).click();
  await expect(page.getByText('Usually I wake up at seven.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `test-results/report-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
test('preview exercises can be practiced and vocabulary reviewed', async ({ page }) => {
  await page.goto('/learn');
  const exercise = page.locator('.exercise-card').first();
  await exercise.getByRole('button', { name: 'Show answer' }).click();
  await expect(exercise.getByText('went', { exact: true })).toBeVisible();
  await exercise.getByRole('button', { name: 'I practiced this' }).click();
  await expect(exercise.getByRole('button', { name: 'Practice again' })).toBeVisible();
  await page.getByRole('tab', { name: 'Saved phrases' }).click();
  await page.getByRole('button', { name: 'Recall the meaning' }).first().click();
  await expect(page.getByText('A place you visit often.', { exact: true })).toBeVisible();
});
test('missing credentials have an actionable sign-in state', async ({ page }) => {
  await page.goto('/signin');
  await page.getByRole('textbox', { name: 'Your email address' }).fill('learner@example.com');
  await page.getByRole('button', { name: 'Send me a sign-in link' }).click();
  await expect(page.locator('.alert[role="alert"]')).toContainText('Supabase configuration');
});
test('private API fails closed without credentials', async ({ request }) => {
  const response = await request.get('/api/bootstrap');
  expect(response.status()).toBe(503);
  const body = await response.json();
  expect(body.error).toContain('not configured');
});

test('Google sign-in explains missing setup and stays retryable', async ({ page }) => {
  await page.goto('/signin');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.locator('.auth-card').getByRole('alert')).toContainText('enabled Google provider');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Send me a sign-in link' })).toBeEnabled();
});

test('cancelled Google login returns to a safe recovery screen', async ({ page }) => {
  await page.goto('/auth/callback?error=access_denied&error_description=untrusted-provider-text');
  await expect(page).toHaveURL(/\/signin\?error=oauth$/);
  await expect(page.locator('.auth-card').getByRole('alert')).toContainText('Google sign-in was cancelled');
  await expect(page.getByText('untrusted-provider-text')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
});
