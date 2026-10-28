import { expect, type Page } from '@playwright/test'

export async function chooseLearnInputMode(page: Page, mode: 'auto' | 'touch' | 'keyboard') {
  const control = page.locator('button[data-input-mode]')
  await expect(control).toBeVisible()
  for (let i = 0; i < 3 && await control.getAttribute('data-input-mode') !== mode; i++) {
    await control.click()
  }
  await expect(control).toHaveAttribute('data-input-mode', mode)
}
