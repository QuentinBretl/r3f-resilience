import { expect, test } from '@playwright/test';

// The README makes four measurable claims. A repository whose argument is
// "stop believing this and count it" has no business asserting any of them by
// hand, so these run the demo and read the same counter a visitor reads.
//
// Numbers are compared as "zero" or "more than zero" rather than to the values
// quoted in the README. Those were measured on a discrete GPU; CI renders
// through SwiftShader and produces far fewer frames in the same wall time. The
// finding is that the driver refuses the call at all, and that survives both:
// measured at 686 errors on an RX 5700 XT and 15 headless, from the same
// GL_INVALID_OPERATION.

const stat = (page, label) =>
  page
    .locator('.panel .grid div', { has: page.locator(`dt:text-is("${label}")`) })
    .locator('dd');

const toggle = (page, label) => page.getByText(label, { exact: false }).first();

/** Waits for the render loop to have produced at least one sample. */
async function waitForFirstSample(page) {
  await expect(stat(page, 'shader programs')).not.toHaveText('—', { timeout: 30_000 });
}

async function glErrors(page) {
  return Number(await stat(page, 'gl errors').textContent());
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForFirstSample(page);
});

test('the scene renders clean: programs settle and no GL call is refused', async ({ page }) => {
  await expect(stat(page, 'shader programs')).not.toHaveText('0');
  await expect(stat(page, 'textures')).not.toHaveText('0');
  expect(await glErrors(page)).toBe(0);

  // Flat, not merely zero once: a leak shows up as a number that climbs while
  // nothing on screen changes.
  const programs = await stat(page, 'shader programs').textContent();
  await page.waitForTimeout(2000);
  await expect(stat(page, 'shader programs')).toHaveText(programs);
  expect(await glErrors(page)).toBe(0);
});

test('SMAA makes the driver refuse blits, MSAA does not', async ({ page }) => {
  expect(await glErrors(page)).toBe(0);
  await expect(stat(page, 'antialiasing')).toContainText('MSAA');

  await toggle(page, 'Antialias with SMAA instead of MSAA').click();
  await expect(stat(page, 'antialiasing')).toHaveText('SMAA');

  // Every blit is refused, so the count climbs for as long as the effect is on.
  await expect
    .poll(() => glErrors(page), { timeout: 20_000, message: 'gl errors should climb with SMAA' })
    .toBeGreaterThan(0);

  const first = await glErrors(page);
  await page.waitForTimeout(2000);
  expect(await glErrors(page)).toBeGreaterThan(first);
});

test('a lost context is reported when the app looks, and silent when it does not', async ({
  page,
}) => {
  // Detection on: the notice covers the canvas and restoring brings it back.
  await page.getByRole('button', { name: 'Kill the WebGL context' }).click();
  const notice = page.locator('.lost');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('The WebGL context is gone');

  await notice.getByRole('button', { name: 'Restore the context' }).click();
  await expect(notice).toBeHidden();
  await waitForFirstSample(page);

  // Detection off: the same kill leaves nothing on the page saying so. This is
  // the actual failure — not that the scene cannot come back, but that the
  // application is never told it went.
  await toggle(page, 'Let the application notice').click();
  await page.getByRole('button', { name: 'Kill the WebGL context' }).click();
  await page.waitForTimeout(1000);
  await expect(page.locator('.lost')).toHaveCount(0);
});

test('the effect chain survives a context loss without being rebuilt', async ({ page }) => {
  // The advice is to re-key the composer after a restore. Left alone, it keeps
  // rendering and refuses nothing.
  await page.getByRole('button', { name: 'Kill the WebGL context' }).click();
  await page.locator('.lost').getByRole('button', { name: 'Restore the context' }).click();
  await expect(page.locator('.lost')).toBeHidden();
  await waitForFirstSample(page);

  await page.waitForTimeout(2000);
  expect(await glErrors(page)).toBe(0);
});

test('the quality tier changes the budget it advertises', async ({ page }) => {
  await page.getByRole('button', { name: 'perf', exact: true }).click();
  await expect(stat(page, 'shadows')).toHaveText('off');
  await expect(stat(page, 'bloom')).toHaveText('off');
  await expect(stat(page, 'antialiasing')).toHaveText('none');
  await expect(stat(page, 'dpr range')).toContainText('1.5');

  await page.getByRole('button', { name: 'high', exact: true }).click();
  await expect(stat(page, 'shadows')).toHaveText('on');
  await expect(stat(page, 'bloom')).toHaveText('on');
  await expect(stat(page, 'antialiasing')).toContainText('MSAA');

  expect(await glErrors(page)).toBe(0);
});
