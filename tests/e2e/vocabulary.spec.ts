import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { emptyData } from '../../src/lib/data';

async function setup(page: Page) {
  await page.route('**/api/bootstrap', (route) => route.fulfill({ json: emptyData }));
  await page.addInitScript(() => {
    const spoken: string[] = [];
    Object.defineProperty(window, 'vocabularySpoken', { value: spoken });
    class Utterance {
      lang = '';
      rate = 1;
      onend: null | (() => void) = null;
      onerror = null;
      constructor(public text: string) {}
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance });
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        cancel() {},
        resume() {},
        getVoices: () => [{ lang: 'en-US', name: 'English' }],
        speak(utterance: Utterance) {
          spoken.push(utterance.text);
          setTimeout(() => utterance.onend?.(), 10);
        },
      },
    });
  });
}
test('browses categories, searches across them, and hears words and examples without signing in', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/vocabulary');
  await expect(page.getByRole('heading', { name: 'Everyday vocabulary.' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(12);
  await page.getByRole('button', { name: /^Work & study/ }).click();
  await expect(page.getByRole('article', { name: 'colleague', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'wake up', exact: true })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search everyday vocabulary' }).fill('receipt');
  await expect(page.getByRole('article')).toHaveCount(1);
  const card = page.getByRole('article', { name: 'receipt', exact: true });
  await expect(card).toContainText('A record showing that you paid for something.');
  await card.getByRole('button', { name: 'Hear word' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { vocabularySpoken: string[] }).vocabularySpoken),
    )
    .toContain('receipt');
  await card.getByRole('button', { name: 'Hear example' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { vocabularySpoken: string[] }).vocabularySpoken),
    )
    .toContain('Please keep your receipt.');
  await page.getByRole('button', { name: 'Clear vocabulary search' }).click();
  await expect(page.getByRole('article')).toHaveCount(24);
  await page.getByRole('button', { name: 'Show more words' }).click();
  await expect(page.getByRole('article')).toHaveCount(48);
});
test('recovers from an empty search and remains accessible on small screens', async ({
  page,
}, info) => {
  await setup(page);
  await page.goto('/vocabulary');
  await page.getByRole('searchbox', { name: 'Search everyday vocabulary' }).fill('zzzzzzzzzz');
  await expect(page.getByRole('heading', { name: 'No matching words yet' })).toBeVisible();
  await page.getByRole('button', { name: 'Show all vocabulary' }).click();
  await page.getByRole('button', { name: /^Food & kitchen/ }).click();
  await expect(page.getByRole('article', { name: 'ingredient', exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(12);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
  await page.screenshot({ path: `.tmp/vocabulary-${info.project.name}.png`, fullPage: true });
});
