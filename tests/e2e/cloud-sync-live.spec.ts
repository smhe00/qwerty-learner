import { expect, test, type Page } from '@playwright/test'

const liveUrl = process.env.QWERTY_SYNC_BASE_URL
const username = process.env.QWERTY_E2E_USERNAME
const password = process.env.QWERTY_E2E_PASSWORD

if (!liveUrl) throw new Error('QWERTY_SYNC_BASE_URL is required')
if (!username) throw new Error('QWERTY_E2E_USERNAME is required')
if (!password) throw new Error('QWERTY_E2E_PASSWORD is required')

async function openDataSettings(page: Page) {
  await page.goto(liveUrl, { waitUntil: 'domcontentloaded' })

  const dismiss = page.getByRole('button', { name: '关闭提示' })
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click()
  }

  await page.getByRole('button', { name: '打开设置对话框' }).click()
  await page.getByRole('tab', { name: '数据设置' }).click()
  await expect(page.getByText('云端同步', { exact: true })).toBeVisible()
}

async function addLocalWordRecord(page: Page, suffix: string) {
  await page.evaluate(async (value) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('wordRecords', 'readwrite')
        transaction.objectStore('wordRecords').add({
          word: `edgeone-e2e-${value}`,
          timeStamp: Math.floor(Date.now() / 1000),
          dict: 'cet4',
          chapter: 0,
          timing: [80, 95, 110],
          wrongCount: 0,
          mistakes: {},
        })
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    } finally {
      database.close()
    }
  }, suffix)
}

async function wordRecordCount(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    try {
      return await new Promise<number>((resolve, reject) => {
        const transaction = database.transaction('wordRecords', 'readonly')
        const request = transaction.objectStore('wordRecords').count()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } finally {
      database.close()
    }
  })
}

async function advanceRemoteWithCurrentSnapshot(page: Page) {
  return page.evaluate(async () => {
    const rawAuth = localStorage.getItem('qwerty.cloudAuth.v1')
    if (!rawAuth) throw new Error('missing cloud auth state')

    const auth = JSON.parse(rawAuth) as { token: string }
    const headers = { Authorization: `Bearer ${auth.token}` }

    const currentResponse = await fetch('/api/sync', { headers })
    if (!currentResponse.ok) {
      throw new Error(`GET /api/sync failed with HTTP ${currentResponse.status}`)
    }

    const current = (await currentResponse.json()) as {
      revision: number
      payloadBase64: string | null
      clientFormatVersion: string | null
    }

    if (!current.payloadBase64) throw new Error('remote snapshot is empty')

    const uploadedResponse = await fetch('/api/sync', {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        baseRevision: current.revision,
        payloadBase64: current.payloadBase64,
        deviceId: 'edgeone-ui-e2e-remote',
        clientFormatVersion: current.clientFormatVersion || 'qwerty-dexie-json-v1',
      }),
    })

    if (!uploadedResponse.ok) {
      throw new Error(`PUT /api/sync failed with HTTP ${uploadedResponse.status}`)
    }

    return uploadedResponse.json() as Promise<{ revision: number }>
  })
}

test('real browser register, upload, divergence detection and download restore', async ({ page }) => {
  test.setTimeout(120_000)

  await openDataSettings(page)

  await page.getByPlaceholder('用户名').fill(username)
  await page.getByPlaceholder('密码（8-128字符）').fill(password)
  await page.getByRole('button', { name: '注册' }).click()

  await expect(page.getByText(`账号：${username}`)).toBeVisible()
  await expect(page.getByText('云端 revision：')).toContainText('0')

  await addLocalWordRecord(page, 'baseline')
  await page.getByRole('button', { name: '刷新状态' }).click()
  await expect(page.getByText('本地有未上传修改')).toBeVisible()

  await page.getByRole('button', { name: '上传本地数据' }).click()
  await expect(page.getByText('已上传到云端 revision 1。')).toBeVisible()
  await expect(page.getByText('本地与云端一致')).toBeVisible()

  expect(await wordRecordCount(page)).toBe(1)

  await addLocalWordRecord(page, 'local-dirty')
  await page.getByRole('button', { name: '刷新状态' }).click()
  await expect(page.getByText('本地有未上传修改')).toBeVisible()
  expect(await wordRecordCount(page)).toBe(2)

  const remoteAdvance = await advanceRemoteWithCurrentSnapshot(page)
  expect(remoteAdvance.revision).toBe(2)

  await page.getByRole('button', { name: '刷新状态' }).click()
  await expect(page.getByText('本地与云端均有变化，需要手动选择')).toBeVisible()
  await expect(page.getByText(/检测到分叉/)).toBeVisible()

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '使用云端数据' }).click()

  await expect(page.getByText('已恢复云端 revision 2。')).toBeVisible()
  await expect(page.getByText('本地与云端一致')).toBeVisible()
  expect(await wordRecordCount(page)).toBe(1)
})
