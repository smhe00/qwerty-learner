import { expect, test } from '@playwright/test'

test('production build resolves lazy navigation and preserves Learn session on reload', async ({
  page,
}) => {
  await page.goto('/typing')

  await page.getByRole('link', { name: /词/, exact: false }).first().click()
  await expect(page).toHaveURL(/\/gallery/)
  await expect(
    page.getByText('CET-4', { exact: true }).first(),
  ).toBeVisible()

  await page.goto('/typing')
  await page.getByRole('button', {
    name: '查看数据统计',
    exact: true,
  }).click()
  await expect(page).toHaveURL(/\/analysis$/)
  await page.getByRole('button', { name: '返回', exact: true }).click()

  await page.goto('/typing')
  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  await expect(page).toHaveURL(/\/learn\/session$/)
  await expect(page.getByText('按任意键开始')).toBeVisible()

  const before = await page.evaluate(() => {
    const raw = localStorage.getItem('reviewModeInfo')
    return raw ? JSON.parse(raw) : undefined
  })

  await page.reload()
  await expect(page).toHaveURL(/\/learn\/session$/)

  const reloadDiagnostics = await page.evaluate(() => {
    const overlay = Array.from(document.querySelectorAll('p')).find(
      (element) => element.textContent?.trim() === '按任意键开始',
    )
    const overlayStyle = overlay ? getComputedStyle(overlay) : undefined
    const overlayRect = overlay?.getBoundingClientRect()
    const currentWord = document.querySelector('[data-typing-word]')

    return {
      reviewModeInfo: localStorage.getItem('reviewModeInfo'),
      currentDict: localStorage.getItem('currentDict'),
      currentChapter: localStorage.getItem('currentChapter'),
      startButton: Boolean(document.querySelector('button[aria-label="开始"]')),
      pauseButton: Boolean(document.querySelector('button[aria-label="暂停"]')),
      currentWord: currentWord?.getAttribute('data-typing-word') ?? null,
      overlay: overlay
        ? {
            display: overlayStyle?.display,
            visibility: overlayStyle?.visibility,
            opacity: overlayStyle?.opacity,
            width: overlayRect?.width,
            height: overlayRect?.height,
          }
        : null,
    }
  })
  console.log('P0_PROD_RELOAD_DIAG', JSON.stringify(reloadDiagnostics))

  await expect(page.getByText('按任意键开始')).toBeVisible()

  const after = await page.evaluate(() => {
    const raw = localStorage.getItem('reviewModeInfo')
    return raw ? JSON.parse(raw) : undefined
  })

  expect(after?.reviewRecord?.id ?? after?.reviewRecord?.createTime).toBe(
    before?.reviewRecord?.id ?? before?.reviewRecord?.createTime,
  )
})
