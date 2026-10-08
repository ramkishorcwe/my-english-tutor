import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
for (const path of ['/', '/practice', '/report/demo', '/learn', '/settings', '/signin'])
  test(`accessible page ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.locator('.loading-state').waitFor({ state: 'detached' });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
    ).toEqual([]);
  });
