import { expect, test, type Page } from '@playwright/test'

async function setupSample(page: Page) {
  await page.goto('/tests/e2e/backup-harness.html')
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__backupHarness?.analyzeV4SnapshotSize))).toBe(true)
  return page.evaluate(async () => {
    const h = (window as any).__backupHarness
    await h.seed()
    localStorage.removeItem('qwerty.cloudAuth.v1')
    await h.initializeLegacyWorkspace({ kind: 'anonymous' })
    const snapshot = await h.captureWorkingWorkspaceV4({ kind: 'anonymous' })
    const report = await h.analyzeV4SnapshotSize(snapshot)
    const fingerprint = await h.workspaceFingerprintV4(snapshot)
    return { report, fingerprint }
  })
}

async function openData(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '打开设置对话框' }).click()
  await page.getByRole('tab', { name: '数据设置' }).click()
}

test('V4 capacity overview reflects actual gzip snapshot, not obsolete HTTP Base64', async ({ page }) => {
  const expected = await setupSample(page)
  await openData(page)
  await expect(page.getByRole('button', { name: '导出完整备份' })).toBeVisible()
  await expect(page.getByRole('button', { name: '分析备份容量（只读）' })).toBeVisible()
  await page.getByRole('button', { name: '分析备份容量（只读）' }).click()

  const section = page.locator('[data-v4-size-report]')
  await expect(section).toBeVisible({ timeout: 35_000 })
  // The pre-mount seed and running app can differ in minor navigation /
  // settings fields. Validate visible sizes against this baseline within
  // 1 KiB, and independently verify all durable table row counts below.
  const metrics = await section.locator('.grid > div').allTextContents()
  const displayedKiB = (text: string) => {
    const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*KiB/)
    if (!match) throw new Error('Missing KiB metric: ' + text)
    return Number(match[1])
  }
  expect(metrics).toHaveLength(2)
  expect(displayedKiB(metrics[0])).toBeGreaterThan(0)
  expect(displayedKiB(metrics[1])).toBeGreaterThan(displayedKiB(metrics[0]))
  expect(Math.abs(displayedKiB(metrics[0]) - expected.report.gzipBytes / 1024))
    .toBeLessThan(1)
  expect(Math.abs(displayedKiB(metrics[1]) - expected.report.rawBytes / 1024))
    .toBeLessThan(1)
  await expect(section).not.toContainText('HTTP Base64 约')
  await expect(section).toContainText('不是 IndexedDB 的磁盘占用')
  await expect(section).toContainText('不可直接相加')

  await expect(section.getByRole('table')).not.toBeVisible()
  await section.getByText('六张数据表 · 详细占用').click()
  await expect(section.getByRole('table')).toBeVisible()
  await expect(section.locator('tbody tr')).toHaveCount(6)
  for (const item of expected.report.tables) {
    await expect(section.getByRole('row').filter({ hasText:item.name })).toContainText(String(item.rows))
  }
  await section.getByText('历史数据精简潜力 · 仅模拟').click()
  await expect(section).toContainText('没有验证精简后的文件可用于恢复')
  await expect(section).toContainText('只读分析：未修改、上传、归档或删除')

  await page.goto('/tests/e2e/backup-harness.html')
  const after = await page.evaluate(async () => {
    const h = (window as any).__backupHarness
    return h.workspaceFingerprintV4(await h.captureWorkingWorkspaceV4({kind:'anonymous'}))
  })
  expect(after, 'capacity analysis must not modify learning data').toBe(expected.fingerprint)
})

test('Data heading and descriptions remain legible in dark mode', async ({page}) => {
  await setupSample(page)
  await openData(page)
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  const result = await page.evaluate(() => {
    const heading = [...document.querySelectorAll('section')]
      .flatMap(s=>[...s.querySelectorAll('div')])
      .find(el=>el.textContent === '本地备份')!
    const color = getComputedStyle(heading).color
    const bg = getComputedStyle(document.querySelector('[role="dialog"] .focus-overlay-panel')!).backgroundColor
    const parse = (text:string)=> (text.match(/[0-9]+/g)||[]).slice(0,3).map(Number)
    const lum = (rgb:number[]) => {
      const linear = rgb.map(n => {
        const s=n/255
        return s<=0.04045?s/12.92:Math.pow((s+0.055)/1.055,2.4)
      })
      return 0.2126*linear[0]+0.7152*linear[1]+0.0722*linear[2]
    }
    const a=lum(parse(color)),b=lum(parse(bg))
    return {ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05),color,bg}
  })
  expect(result.ratio,'dark heading must be readable: '+JSON.stringify(result)).toBeGreaterThan(4.5)
  await expect(page.getByText('高级操作 · 清除本地数据')).toBeVisible()
  await expect(page.getByRole('button', {name:'清除本地数据'})).not.toBeVisible()
})
