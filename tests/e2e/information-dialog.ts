import { expect, type Page } from '@playwright/test'

/** Acknowledge only the shipped informational modal, never a recovery/ownership guard. */
export async function acknowledgeInformationDialog(page: Page) {
  // An aria-modal native dialog makes the mounted application's roles inert.
  // Check its actual DOM entry before querying background accessible roles.
  await expect(page.locator('[data-account-entry]')).toBeVisible({ timeout: 60_000 })
  const notice = page.locator('dialog.safety-information-dialog[open]')
  if (await notice.isVisible()) {
    await expect(notice).toHaveAttribute('aria-label', '提示')
    await notice.getByRole('button', { name: '知道了', exact: true }).click()
    await expect(notice).toHaveCount(0)
  }
}
