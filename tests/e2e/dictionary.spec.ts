import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { defaultProfile } from '../../src/lib/schema';
import type { DictionaryEntry } from '../../src/lib/dictionary';
test.skip(
  process.env.PLAYWRIGHT_WRITING_CONFIGURED !== '1',
  'Requires dummy public Supabase settings.',
);
async function setup(page: Page) {
  const entries: DictionaryEntry[] = [];
  await page.route('**/api/bootstrap', (route) =>
    route.fulfill({
      json: {
        user: { id: 'learner', email: 'learner@example.com' },
        profile: defaultProfile,
        sessions: [],
        exercises: [],
        vocabulary: [],
        reports: [],
        voiceConfigured: true,
      },
    }),
  );
  await page.route('**/api/dictionary**', (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (request.method() === 'GET')
      return route.fulfill({
        json: {
          entries: entries.filter((e) =>
            e.term.toLowerCase().includes((url.searchParams.get('q') || '').toLowerCase()),
          ),
          hasMore: false,
        },
      });
    if (request.method() === 'DELETE') {
      const index = entries.findIndex((e) => e.id === url.searchParams.get('id'));
      if (index >= 0) entries.splice(index, 1);
      return route.fulfill({ json: { ok: true } });
    }
    const body = request.postDataJSON();
    if (body.text === 'fail')
      return route.fulfill({
        status: 503,
        json: { error: 'Translation is temporarily unavailable.' },
      });
    let entry = entries.find(
      (e) =>
        e.term.toLowerCase() === body.text.toLowerCase() &&
        e.target_language === body.targetLanguage,
    );
    if (!entry) {
      entry = {
        id: crypto.randomUUID(),
        term: body.text,
        target_language: body.targetLanguage,
        source_language: 'English',
        translation: 'पहल करना',
        meaning: 'To take the first step without being asked.',
        example: 'She took the initiative to organise the meeting.',
        last_searched_at: new Date().toISOString(),
      };
      entries.unshift(entry);
    }
    return route.fulfill({ json: { entry, saved: true } });
  });
  return entries;
}
test('translation searches are saved, searchable, deduplicated, and removable', async ({
  page,
}, info) => {
  const entries = await setup(page);
  await page.goto('/dictionary');
  await expect(page.getByRole('heading', { name: 'My dictionary.', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Translate into' })).toHaveValue('Hindi');
  await page.getByRole('textbox', { name: 'Word, phrase, or text' }).fill('take the initiative');
  await page.getByRole('button', { name: 'Translate & save', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved to your personal dictionary');
  await expect(page.locator('.translation-result')).toContainText('पहल करना');
  await expect(page.locator('.dictionary-card')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Word, phrase, or text' }).fill('TAKE THE INITIATIVE');
  await page.getByRole('button', { name: 'Translate & save', exact: true }).click();
  await expect(page.locator('.dictionary-card')).toHaveCount(1);
  expect(entries).toHaveLength(1);
  await page.reload();
  await expect(page.locator('.dictionary-card')).toContainText('take the initiative');
  const search = page.getByRole('textbox', { name: 'Search your dictionary' });
  await search.fill('not found');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('No saved words match your search.')).toBeVisible();
  await search.fill('initiative');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.dictionary-card')).toHaveCount(1);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `test-results/dictionary-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Remove take the initiative from dictionary' }).click();
  await expect(page.locator('.dictionary-card')).toHaveCount(0);
  expect(entries).toHaveLength(0);
});
test('failed translations are not shown as saved', async ({ page }) => {
  const entries = await setup(page);
  await page.goto('/dictionary');
  await page.getByRole('textbox', { name: 'Word, phrase, or text' }).fill('fail');
  await page.getByRole('button', { name: 'Translate & save', exact: true }).click();
  await expect(page.locator('.translation-tool [role="alert"]')).toContainText(
    'Translation is temporarily unavailable.',
  );
  await expect(page.getByText('Saved to your personal dictionary', { exact: true })).toHaveCount(0);
  expect(entries).toHaveLength(0);
});
