// Checks that were only read in code before (audit items A-06, A-09, A-21, A-23, A-25, A-28), now in the built interface:
// the English window has no Polish text, the old provider list moves to the engine, the tagging switch shows the saved state,
// and "Zapisano" appears beside the control that was clicked.
import { test, expect } from '@playwright/test';
import { mockRuntime } from './mock-runtime.mjs';

const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
// Product and demo names that really contain Polish letters, and Spanish-origin language names from CLDR.
const ALLOWED = [/Róża/, /Michał/, /Arequipa|Rayón/];

async function english(page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.setItem('seventy-seven-labs.ui-language.v1', 'en');
    sessionStorage.setItem('seeded', '1');
  });
}
async function visibleTexts(page) {
  return page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode());) { const text = node.textContent.trim(); if (text && !['SCRIPT', 'STYLE'].includes(node.parentElement?.tagName)) out.push(text); }
    const attributes = ['aria-label', 'placeholder', 'title'];
    for (const el of document.querySelectorAll('[aria-label],[placeholder],[title]')) {
      for (const name of attributes) { const value = el.getAttribute(name); if (value) out.push(value); }
    }
    return out;
  });
}
const polishIn = texts => texts.filter(text => POLISH.test(text) && !ALLOWED.some(pattern => pattern.test(text)));
const openSettings = async (page, section) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.locator('.settings-navigation nav').getByRole('button', { name: section, exact: true }).click();
};

test('English window: the home screen, the studio screens and the settings pages contain no Polish text', async ({ page }) => {
  await english(page); await mockRuntime(page);
  await page.goto('/'); await page.waitForTimeout(1200);
  const found = polishIn(await visibleTexts(page));
  for (const name of ['Text to speech', 'Speech to text', 'Dubbing', 'Audiobooks', 'Projects']) {
    await page.getByRole('button', { name }).first().click(); await page.waitForTimeout(600);
    found.push(...polishIn(await visibleTexts(page)));
  }
  for (const section of ['General', 'Engine', 'Models', 'AI and keys', 'Storage', 'Privacy and usage']) {
    await page.goto('/'); await page.waitForTimeout(500);
    await openSettings(page, section); await page.waitForTimeout(800);
    found.push(...polishIn(await visibleTexts(page)));
  }
  expect([...new Set(found)]).toEqual([]);
});

test('English window: the component gallery contains no Polish text', async ({ page }) => {
  await english(page); await mockRuntime(page);
  await page.goto('/inputy.html'); await page.waitForTimeout(2000);
  expect([...new Set(polishIn(await visibleTexts(page)))]).toEqual([]);
});

test('the old localStorage provider list moves to the engine and the old key is removed', async ({ page }) => {
  await english(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('legacy')) return;
    localStorage.setItem('voicestudio.ai.providers.v1', JSON.stringify(['ollama']));
    sessionStorage.setItem('legacy', '1');
  });
  const ollama = { id: 'ollama', display_name: 'Ollama', local: true, base_url: 'http://127.0.0.1:11434', model: '', has_key: false, configured: false };
  const seen = await mockRuntime(page, { '/api/settings/llm-providers': { providers: [ollama], active: null } });
  await page.goto('/'); await openSettings(page, 'AI and keys'); await page.waitForTimeout(2500);
  expect(seen.writes.filter(write => write.path.endsWith('added-llm-providers')).map(write => write.body)).toEqual([{ ids: ['ollama'] }]);
  expect(await page.evaluate(() => localStorage.getItem('voicestudio.ai.providers.v1'))).toBeNull();
});

test('AI tagging switch shows the saved state even when Codex is signed out', async ({ page }) => {
  await english(page); await mockRuntime(page);
  await page.goto('/'); await openSettings(page, 'AI and keys');
  await page.getByRole('tab', { name: 'AI features' }).click();
  await expect(page.getByRole('switch', { name: 'Turn on: automatic AI tagging' })).toBeChecked();
  await expect(page.getByText('Turned on, but Codex is not signed in.')).toBeVisible();
  await page.getByRole('tab', { name: 'Language models' }).click();
  await expect(page.getByRole('button', { name: 'Add provider' })).toBeVisible();
});

test('"Saved" appears beside the switch that was clicked', async ({ page }) => {
  await english(page); await mockRuntime(page);
  await page.goto('/'); await openSettings(page, 'Engine');
  await page.getByRole('tab', { name: 'Startup and memory' }).click();
  const toggle = page.getByRole('switch', { name: 'Start the engine when the app opens' });
  await toggle.click();
  await expect(toggle.locator('xpath=ancestor::div[contains(@class,"p-row")][1]').locator('.saved')).toHaveText('Saved');
});
