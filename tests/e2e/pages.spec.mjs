// Five named pages: render without page errors and have no serious or critical axe violation; plus a Tab-order assertion.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockRuntime } from './mock-runtime.mjs';

const openSettings = async (page, section) => {
  await page.getByRole('button', { name: 'Ustawienia', exact: true }).first().click();
  await page.locator('.settings-navigation nav').waitFor();
  if (section) await page.locator('.settings-navigation nav').getByRole('button', { name: section, exact: true }).click();
};

const PAGES = [
  ['Pulpit', async page => { await expect(page.getByText('Twój głos.')).toBeVisible(); }],
  ['Tekst na mowę', async page => { await page.getByRole('button', { name: 'Tekst na mowę' }).first().click(); await page.waitForTimeout(500); }],
  ['Ustawienia → Ogólne', async page => openSettings(page, 'Ogólne')],
  ['Ustawienia → Silnik', async page => openSettings(page, 'Silnik')],
  ['Ustawienia → Modele', async page => openSettings(page, 'Modele')],
];

for (const [name, open] of PAGES) {
  test(`${name}: renders and has no serious or critical accessibility violation`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await mockRuntime(page);
    await page.goto('/');
    await page.waitForSelector('nav, aside, main');
    await open(page);
    await page.waitForTimeout(800);
    expect(errors).toEqual([]);
    const result = await new AxeBuilder({ page }).analyze();
    const blocking = result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking.map(v => `${v.impact} ${v.id}: ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
  });
}

test('Tab moves forward through the interface without a trap', async ({ page }) => {
  await mockRuntime(page);
  await page.goto('/');
  await page.waitForSelector('nav, aside, main');
  const seen = [];
  for (let step = 0; step < 14; step++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const all = [...document.querySelectorAll('*')];
      return { index: all.indexOf(el), label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40) };
    });
    expect(stop, `focus is on an element after Tab ${step + 1}`).not.toBeNull();
    seen.push(stop);
  }
  expect(new Set(seen.map(stop => stop.index)).size, `no repeated focus stop in ${JSON.stringify(seen.map(s => s.label))}`).toBe(seen.length);
  const order = seen.map(stop => stop.index);
  expect(order, 'the first stops follow the document order').toEqual([...order].sort((a, b) => a - b));
});
