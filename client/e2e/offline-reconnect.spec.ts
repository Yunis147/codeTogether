import { expect, test, type Page } from '@playwright/test';

async function editorText(page: Page): Promise<string> {
  return page.locator('.monaco-editor .view-lines').innerText();
}

async function appendToEditor(
  page: Page,
  value: string,
): Promise<void> {
  await page.locator('.monaco-editor .view-line').last().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(value);
}

test('offline editor changes merge after reconnecting', async ({ browser, baseURL }) => {
  const ownerContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const guest = await guestContext.newPage();
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    await owner.goto(baseURL!);
    await owner.getByRole('button', { name: 'Create account' }).click();
    await owner.getByLabel('Display name').fill('Offline Owner');
    await owner.getByLabel('Email').fill(`owner-${nonce}@example.test`);
    await owner.getByLabel('Password').fill('reconnect-test-password');
    await owner.locator('form').getByRole('button', { name: 'Create account' }).click();
    await owner.waitForURL(/\/room\//);

    const roomId = new URL(owner.url()).pathname.split('/').pop()!;
    const link = await owner.evaluate(async (id) => {
      const response = await fetch(`/api/rooms/${id}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'EDITOR' }),
      });
      if (!response.ok) throw new Error(`Share link request failed: ${response.status}`);
      return (await response.json() as { link: { token: string } }).link.token;
    }, roomId);

    await guest.goto(`${baseURL}/join/${link}`);
    await guest.getByLabel('Your display name').fill('Offline Guest');
    await guest.getByRole('button', { name: 'Join as editor' }).click();
    await guest.waitForURL(new RegExp(`/room/${roomId}$`));

    await expect(owner.locator('.monaco-editor')).toBeVisible();
    await expect(guest.locator('.monaco-editor')).toBeVisible();
    await expect(owner.getByText('Offline Guest')).toBeVisible({ timeout: 15_000 });
    await expect(guest.getByText('Offline Owner')).toBeVisible({ timeout: 15_000 });

    const ownerChange = `\n// owner-${nonce}`;
    const offlineChange = `\n// guest-offline-${nonce}`;

    await appendToEditor(owner, ownerChange);
    await expect.poll(() => editorText(owner)).toContain(`owner-${nonce}`);
    await expect.poll(() => editorText(guest)).toContain(`owner-${nonce}`);

    await guestContext.setOffline(true);
    await appendToEditor(guest, offlineChange);
    await expect.poll(() => editorText(guest)).toContain(`guest-offline-${nonce}`);

    await guestContext.setOffline(false);

    await expect.poll(() => editorText(owner), { timeout: 15_000 }).toContain(
      `guest-offline-${nonce}`,
    );
    await expect.poll(() => editorText(guest), { timeout: 15_000 }).toContain(
      `owner-${nonce}`,
    );
  } finally {
    await ownerContext.close();
    await guestContext.close();
  }
});
