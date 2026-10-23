import { expect, test } from '@playwright/test'

test('fresh anonymous workspace boots and retains startup metrics across navigation', async ({ page }) => {
  await page.goto('/')
  await expect.poll(async () => page.evaluate(() => {
    const entries = JSON.parse(sessionStorage.getItem('qwerty.perf-diagnostics.v1') ?? '[]')
    return entries.some((entry: { stage?: string }) => entry.stage === 'guarded-bootstrap')
  })).toBe(true)
  await expect(page.locator('body')).not.toContainText('学习数据安全检查未通过')
  // The fresh anonymous S1 admission intentionally reloads the SAME route
  // after its registry CAS. Seeing the guarded-bootstrap timing entry does
  // not mean that reload has finished or that the app holds its new lease.
  // Wait for an actual mounted writer-capable app before navigating away.
  await expect(page.getByRole('button', { name: '打开设置对话框' }))
    .toBeVisible({ timeout: 15_000 })
  await page.goto('/?perf-report=view')
  await expect(page.getByRole('heading', {
    name: 'Qwerty Plus 启动与同步性能报告',
  })).toBeVisible()
  const samples = await page.evaluate(() => JSON.parse(
    sessionStorage.getItem('qwerty.perf-diagnostics.v1') ?? '[]'))
  expect(samples.some((sample: { stage?: string }) =>
    sample.stage === 'guarded-bootstrap')).toBe(true)
  expect(samples.some((sample: { stage?: string }) =>
    sample.stage === 'writer-lease')).toBe(true)
  for (const sample of samples) {
    expect(Object.keys(sample).sort()).toEqual(expect.arrayContaining(['at', 'flow', 'stage']))
    expect(JSON.stringify(sample)).not.toMatch(/token|password|accountId|learningData/i)
  }
})

test('performance report downloads only bounded fixed metadata', async ({ page }) => {
  await page.goto('/?perf-report=view')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 JSON 报告' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^Qwerty-Plus-Performance-.*\.json$/)
  const read = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const c of read) chunks.push(Buffer.from(c))
  const report = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  expect(report.format).toBe('qwerty-perf-v1')
  expect(Array.isArray(report.samples)).toBe(true)
  expect(report.samples.length).toBeGreaterThan(0)
  expect(report.samples.length).toBeLessThanOrEqual(160)
  expect(JSON.stringify(report)).not.toMatch(/token|password|accountId|learningData/i)
})
