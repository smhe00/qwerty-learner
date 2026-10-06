import { expect, test } from '@playwright/test'

test('Pages basename keeps Learn preparation ownership and header Start placement', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.addInitScript(() => {
    ;(window as Window & {
      __QWERTY_P3_TEST_HOOKS__?: {
        gates?: Record<string, boolean>
      }
    }).__QWERTY_P3_TEST_HOOKS__ = {
      gates: {
        'learn-preparation': true,
      },
    }
  })

  // Enter through the deployed SPA root, then use the same ModeSwitcher path a
  // real Pages user uses. This preserves BrowserRouter basename semantics.
  await page.goto('.')
  await expect(
    page.locator('[data-typing-word]:visible').first(),
  ).toHaveAttribute('data-typing-word', /\S+/)

  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  await expect(page).toHaveURL(/\/qwerty-learner\/learn$/)
  await expect(page.getByText('正在准备 Learn…')).toBeVisible()

  // The idle/preparation Start control belongs with the primary controls in
  // the header, never near the bottom of the Learn landing surface.
  const start = page.locator('header [data-learn-start-control]')
  await expect(start).toBeVisible()
  await expect(start).toBeDisabled()
  await expect(
    page.locator('main > [data-learn-start-control]'),
  ).toHaveCount(0)

  await page.evaluate(() => {
    const target = window as Window & {
      __QWERTY_P3_TEST_HOOKS__?: {
        gates?: Record<string, boolean>
      }
    }
    if (target.__QWERTY_P3_TEST_HOOKS__?.gates) {
      target.__QWERTY_P3_TEST_HOOKS__.gates['learn-preparation'] = false
    }
    window.dispatchEvent(
      new CustomEvent('qwerty:p3-fuzz-release', {
        detail: { gate: 'learn-preparation' },
      }),
    )
  })

  // The historical Pages bug compared window.location.pathname to "/learn".
  // On Pages the physical path is "/qwerty-learner/learn", so a valid prepared
  // session was silently discarded and isStarting stayed true forever.
  await expect(page).toHaveURL(
    /\/qwerty-learner\/learn\/session$/,
    { timeout: 15_000 },
  )
  await expect(page.getByText('按任意键开始')).toBeVisible()
  expect(pageErrors).toEqual([])
})
