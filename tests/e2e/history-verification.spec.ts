import { expect, test } from '@playwright/test'

const fixture = '/tests/e2e/history-verification.html'
async function open(page) {
  await page.goto(fixture)
  await expect.poll(() => page.evaluate(() => !!window['historyFixture'])).toBe(true)
}
test('durable verification progress survives document reload and scopes account/generation', async ({ page }) => {
  await open(page)
  await page.evaluate(() => localStorage.setItem('synthetic-learning-sentinel', 'keep-original'))
  const first = await page.evaluate(() => window['historyFixture'].run())
  expect(first.result.status).toBe('pending')
  await expect(page.getByRole('status')).toHaveText('完整学习数据已同步。历史验证已完成 16/40 批，下次同步将接着处理，可以继续学习。')
  await open(page)
  const second = await page.evaluate(() => window['historyFixture'].run())
  expect(second.result.verifiedReceipts).toBe(32)
  await open(page)
  const final = await page.evaluate(() => window['historyFixture'].run())
  expect(final.result.status).toBe('unchanged')
  expect(final.downloads).toBe(0)
  expect((await page.evaluate(() => window['historyFixture'].run({ generation: 2 }))).result.verifiedReceipts).toBe(16)
  expect((await page.evaluate(() => window['historyFixture'].run({ accountId: 'other-account' }))).result.verifiedReceipts).toBe(16)
  expect(await page.evaluate(() => localStorage.getItem('synthetic-learning-sentinel'))).toBe('keep-original')
})
test('download progress survives reload; corrupted cached rows never become merge-ready', async ({ page }) => {
  await open(page)
  expect((await page.evaluate(() => window['historyFixture'].run({ count: 20, local: false }))).result.status).toBe('pending')
  await open(page)
  const second = await page.evaluate(() => window['historyFixture'].run({ count: 20, local: false }))
  expect(second.result.reason).toBe('verification-download-pending')
  expect(second.downloads).toBe(16)
  await open(page)
  const third = await page.evaluate(() => window['historyFixture'].run({ count: 20, local: false }))
  expect(third.result.status).toBe('witnessed')
  expect(third.downloads).toBe(4)
  await page.evaluate(async () => {
    const cache = window['historyFixture'].cache
    const state = await cache.read('synthetic-history')
    ;(Object.values(state.batches)[0] as any).batch.events[0].word = 'tampered'
    await cache.save('synthetic-history', state)
  })
  await open(page)
  expect((await page.evaluate(() => window['historyFixture'].run({ count: 20, local: false }))).result.reason).toBe(
    'witness-evidence-digest-mismatch',
  )
})
