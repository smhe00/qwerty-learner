import { expect, test } from '@playwright/test'

test('GitHub Pages basename can enter Learn session without hanging on preparation', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('learn')

  await expect(page).toHaveURL(
    /\/qwerty-learner\/learn\/session$/,
    { timeout: 15_000 },
  )
  await expect(page.getByText('按任意键开始')).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('Learn landing Start control lives in the header on Pages', async ({
  page,
}) => {
  let releaseDictionary!: () => void
  const gate = new Promise<void>((resolve) => {
    releaseDictionary = resolve
  })
  let intercepted = false

  await page.route('**/dicts/**', async (route) => {
    if (!intercepted) {
      intercepted = true
      await gate
    }
    await route.continue()
  })

  await page.goto('learn')
  await expect.poll(() => intercepted).toBe(true)

  const start = page.locator('header [data-learn-start-control]')
  await expect(start).toBeVisible()
  await expect(start).toBeDisabled()
  await expect(
    page.locator('main > [data-learn-start-control]'),
  ).toHaveCount(0)

  releaseDictionary()
})
