import { test, expect } from '@playwright/test';
import { demoReport, demoTurns } from '../../src/lib/data';

const id = '90000000-0000-4000-8000-000000000011';
test('a current news topic can be selected, edited, and cleared by choosing a practice mode', async ({
  page,
}, info) => {
  const topic = {
    id: 'news-1',
    title: 'A new approach to clean energy',
    category: 'Science',
    source: 'BBC News',
    url: 'https://www.bbc.com/news/articles/example',
    publishedAt: '2026-10-21T08:00:00Z',
    question: 'What could we learn from this news?',
    practiceTopic: 'News: A new approach to clean energy. What could we learn from this news?',
  };
  await page.route('**/api/topics', (route) =>
    route.fulfill({ json: { topics: [topic], unavailable: false, fetchedAt: topic.publishedAt } }),
  );
  await page.goto('/practice');
  await page.getByRole('button', { name: 'Science', exact: true }).click();
  const discuss = page.getByRole('button', { name: `Discuss: ${topic.title}`, exact: true });
  await discuss.click();
  await expect(page.getByRole('textbox', { name: 'What’s on your mind?' })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'What’s on your mind?' })).toHaveValue(
    topic.practiceTopic,
  );
  await expect(page.getByRole('button', { name: 'Make it your own' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(discuss).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('textbox', { name: 'What’s on your mind?' })
    .fill('My own idea about energy');
  await expect(discuss).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Everyday life' }).click();
  await expect(page.getByRole('textbox', { name: 'What’s on your mind?' })).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `test-results/hot-topics-${info.project.name}.png`,
    fullPage: true,
  });
});

test('news feed failure leaves normal practice usable', async ({ page }) => {
  await page.route('**/api/topics', (route) =>
    route.fulfill({ status: 503, json: { error: 'offline' } }),
  );
  await page.goto('/practice');
  await expect(
    page.getByText('Current headlines are unavailable right now.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Let’s start talking' })).toBeEnabled();
});

test('a failed summary can be retried and displays grounded corrections', async ({ page }) => {
  let reportCalls = 0;
  let saved = false;
  await page.route(`**/api/sessions/${id}`, (route) =>
    route.fulfill({
      json: {
        session: {
          id,
          topic: 'Cafe conversation',
          mode: 'Everyday life',
          created_at: '2026-10-21T08:00:00Z',
          ended_at: '2026-10-21T08:05:00Z',
          status: 'ended',
          report_status: saved ? 'ready' : 'failed',
        },
        turns: demoTurns,
        report: saved ? demoReport : null,
      },
    }),
  );
  await page.route(`**/api/sessions/${id}/report`, (route) => {
    reportCalls++;
    if (reportCalls === 1)
      return route.fulfill({
        status: 503,
        json: {
          error: 'The summary service is busy. Your transcript is saved. Please retry in a minute.',
        },
      });
    saved = true;
    return route.fulfill({ json: demoReport });
  });
  await page.goto(`/report/${id}`);
  await page.getByRole('button', { name: 'Generate or retry report' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'summary service is busy' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Generate or retry report' }).click();
  await expect(page.getByText(demoReport.summary, { exact: true })).toBeVisible();
  await expect(
    page.getByText(demoReport.grammar[0].corrected, { exact: true }).first(),
  ).toBeVisible();
});
