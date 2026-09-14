/**
 * Every story, both themes, asserted green.
 *
 * This drives the explorer's own Tests tab — the same checks you can run by
 * hand in the browser — so a failure here is reproducible by clicking.
 *
 *   npx playwright test
 */

import { test, expect } from '@playwright/test';
import { STORIES } from '../app/stories.js';

const ids = STORIES.map((s) => s.id);

async function runChecks(page) {
  await page.getByRole('tab', { name: 'Tests' }).click();
  await page.getByRole('button', { name: 'Run all checks' }).click();
  const summary = page.getByTestId('test-summary');
  await expect(summary).toHaveAttribute('data-failed', /\d+/);
  return summary;
}

for (const id of ids) {
  test.describe(`story: ${id}`, () => {
    test('passes all checks in light mode', async ({ page }) => {
      await page.goto(`/index.html#/story/${id}`);
      await expect(page.locator('iframe[title="Component preview"]')).toBeVisible();
      const summary = await runChecks(page);
      await expect(summary, await summary.textContent()).toHaveAttribute('data-failed', '0');
    });

    test('passes all checks in dark mode', async ({ page }) => {
      await page.goto(`/index.html#/story/${id}`);
      const toggle = page.getByRole('button', { name: /Theme:/ });
      if ((await toggle.textContent())?.includes('Light')) await toggle.click();
      await expect(toggle).toContainText('Dark');
      const summary = await runChecks(page);
      await expect(summary, await summary.textContent()).toHaveAttribute('data-failed', '0');
    });
  });
}

test.describe('explorer shell', () => {
  test('sidebar search filters the tree', async ({ page }) => {
    await page.goto('/index.html');
    await page.getByLabel('Search components').fill('button');
    const links = page.locator('#tree a');
    await expect(links).toHaveCount(1);
    await expect(links.first()).toContainText('Button');
  });

  test('theme choice survives a reload', async ({ page }) => {
    await page.goto('/index.html');
    await page.getByRole('button', { name: /Theme:/ }).click();
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('every sidebar entry routes to a story', async ({ page }) => {
    await page.goto('/index.html');
    const count = await page.locator('#tree a').count();
    expect(count).toBe(STORIES.length);
    for (let i = 0; i < count; i++) {
      await page.locator('#tree a').nth(i).click();
      await expect(page.locator('#storyTitle')).not.toBeEmpty();
    }
  });
});
