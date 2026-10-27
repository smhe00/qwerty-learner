import { type Page, expect } from '@playwright/test'
import { STARTUP_SYNC_BUDGET_MS } from '../../src/sync/startup-sync-budget'

/** Acknowledge only the shipped informational modal, never a recovery/ownership guard. */
export async function acknowledgeInformationDialog(page: Page, mountTimeoutMs = STARTUP_SYNC_BUDGET_MS + 15_000) {
  // The product may use the full60s network budget before final journal/owner
  // checks and app import. A matching60s assertion can fail before safe mount.
  // Keep a bounded15s local-startup allowance; product deadlines stay unchanged.
  // An aria-modal native dialog makes the mounted application's roles inert.
  // Check its actual DOM entry before querying background accessible roles.
  await expect(page.locator('[data-account-entry]')).toBeVisible({ timeout: mountTimeoutMs })
  const notice = page.locator('dialog.safety-information-dialog[open]')
  if (await notice.isVisible()) {
    await expect(notice).toHaveAttribute('aria-label', '提示')
    await notice.getByRole('button', { name: '知道了', exact: true }).click()
    await expect(notice).toHaveCount(0)
  }
}
