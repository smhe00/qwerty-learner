// RC 2026-09-30 review-reactivation-force-v1 production acceptance marker
// RC 2026-09-30 review-formal-gate-v1 production acceptance marker
// RC 2026-09-30 review-multiword-remount production acceptance marker
// RC 2026-09-30 first-review-seeding-v4 production acceptance marker
import { expect, test, type Page } from '@playwright/test'

const liveUrl = process.env.QWERTY_SYNC_BASE_URL
const username = process.env.QWERTY_E2E_USERNAME
const password = process.env.QWERTY_E2E_PASSWORD

if (!liveUrl) throw new Error('QWERTY_SYNC_BASE_URL is required')
if (!username) throw new Error('QWERTY_E2E_USERNAME is required')
if (!password) throw new Error('QWERTY_E2E_PASSWORD is required')

// Release acceptance waits for the release-specific backend capability so browser assertions never race EdgeOne deployment.
async function waitForProductionCapability(page: Page) {
  const deadline = Date.now() + 180_000

  while (Date.now() < deadline) {
    const capabilities = await page
      .evaluate(async () => {
        const response = await fetch('/api/health', { cache: 'no-store' })
        if (!response.ok) return []
        const data = (await response.json()) as { capabilities?: string[] }
        return Array.isArray(data.capabilities) ? data.capabilities : []
      })
      .catch(() => [])

    if (
      capabilities.includes('plain-gzip-sync-v2') &&
      capabilities.includes('learning-state-backup-v3') &&
      capabilities.includes('account-delete-v1') &&
      capabilities.includes('duplicate-register-protection-v1')
    ) {
      return
    }

    await page.waitForTimeout(5_000)
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
  }

  throw new Error('Timed out waiting for learning-state-backup-v3 production deployment')
}

async function openDataSettings(page: Page) {
  await page.goto(liveUrl, { waitUntil: 'domcontentloaded' })
  await waitForProductionCapability(page)
  await page.reload({ waitUntil: 'domcontentloaded' })

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

async function addReviewCloudFixture(page: Page) {
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          ['wordRecords', 'reviewRecords', 'reviewWordStates'],
          'readwrite',
        )

        transaction.objectStore('wordRecords').add({
          word: 'edgeone-e2e-baseline',
          timeStamp: 1_800_000_000,
          dict: 'cet4',
          chapter: -1,
          timing: [120, 140, 160],
          wrongCount: 2,
          mistakes: {
            1: ['x', 'c'],
          },
          typingTelemetry: {
            telemetryVersion: 2,
            firstKeyLatencyMs: 850,
            attempts: [
              {
                startLatencyMs: 850,
                durationMs: 920,
                correctPrefixLength: 1,
                result: 'wrong',
                wrongIndex: 1,
                wrongKey: 'x',
                interKeyIntervalsMs: [120, 140],
              },
              {
                startLatencyMs: 210,
                durationMs: 780,
                correctPrefixLength: 20,
                result: 'correct',
                interKeyIntervalsMs: [90, 110],
              },
            ],
            backgroundPauseMs: 1200,
            backgroundPauseCount: 1,
          },
          learningContext: {
            version: 1,
            answerVisibilityAtStart: 'hidden',
            answerVisibleRatioAtStart: 0,
            answerRevealed: false,
            revealedBeforeFirstKey: false,
            revealCount: 0,
            meaningVisibleAtStart: true,
            pronunciationEnabledAtStart: true,
            pronunciationPlayed: true,
            pronunciationPlayedBeforeFirstKey: true,
            pronunciationPlayCount: 1,
            pronunciationAutomaticPlayCount: 1,
            pronunciationRequestedPlayCount: 0,
          },
        })

        transaction.objectStore('reviewWordStates').add({
          dict: 'cet4',
          word: 'edgeone-e2e-baseline',
          createdAt: 1_800_000_000,
          updatedAt: 1_800_000_600,
          lastReviewedAt: 1_800_000_600,
          nextReviewAt: 1_800_605_400,
          reviewCount: 4,
          lapseCount: 2,
          cleanStreak: 1,
          lastOutcome: 'hard',
          stateVersion: 3,
          schedulerState: {
            kind: 'basic-v1',
            stage: 2,
            intervalDays: 7,
          },
        })

        transaction.objectStore('reviewRecords').add({
          dict: 'cet4',
          index: 3,
          createTime: 1_800_000_500,
          isFinished: false,
          words: [
            { name: 'abandon', trans: ['放弃'], usphone: 'əˈbændən', ukphone: 'əˈbændən' },
            { name: 'ability', trans: ['能力'], usphone: 'əˈbɪləti', ukphone: 'əˈbɪləti' },
            { name: 'abroad', trans: ['在国外'], usphone: 'əˈbrɔːd', ukphone: 'əˈbrɔːd' },
            { name: 'absorb', trans: ['吸收'], usphone: 'əbˈzɔːrb', ukphone: 'əbˈzɔːb' },
            { name: 'abandon', trans: ['放弃'], usphone: 'əˈbændən', ukphone: 'əˈbændən' },
          ],
        })

        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    } finally {
      database.close()
    }
  })
}

async function readReviewCloudFixture(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    const readAll = (storeName: string) =>
      new Promise<any[]>((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readonly')
        const request = transaction.objectStore(storeName).getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })

    try {
      const [wordRecords, reviewRecords, reviewWordStates] = await Promise.all([
        readAll('wordRecords'),
        readAll('reviewRecords'),
        readAll('reviewWordStates'),
      ])

      return {
        wordRecord: wordRecords.find(
          (record) => record.word === 'edgeone-e2e-baseline' && record.dict === 'cet4',
        ),
        reviewRecord: reviewRecords.find((record) => record.dict === 'cet4'),
        reviewWordState: reviewWordStates.find(
          (state) => state.word === 'edgeone-e2e-baseline' && state.dict === 'cet4',
        ),
      }
    } finally {
      database.close()
    }
  })
}

async function mutateReviewCloudFixture(page: Page, dirty: boolean) {
  await page.evaluate(async (makeDirty) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          ['reviewRecords', 'reviewWordStates'],
          'readwrite',
        )
        const stateStore = transaction.objectStore('reviewWordStates')
        const recordStore = transaction.objectStore('reviewRecords')

        const stateRequest = stateStore.getAll()
        stateRequest.onsuccess = () => {
          const state = stateRequest.result.find(
            (item) => item.word === 'edgeone-e2e-baseline' && item.dict === 'cet4',
          )
          if (!state) {
            transaction.abort()
            return
          }

          stateStore.put({
            ...state,
            updatedAt: makeDirty ? 1_900_000_000 : 1_800_000_600,
            nextReviewAt: makeDirty ? 1_900_605_400 : 1_800_605_400,
            reviewCount: makeDirty ? 99 : 4,
            lapseCount: makeDirty ? 9 : 2,
            cleanStreak: makeDirty ? 0 : 1,
            lastOutcome: makeDirty ? 'again' : 'hard',
            schedulerState: {
              kind: 'basic-v1',
              stage: makeDirty ? 0 : 2,
              intervalDays: makeDirty ? 0 : 7,
            },
          })
        }

        const recordRequest = recordStore.getAll()
        recordRequest.onsuccess = () => {
          const record = recordRequest.result.find((item) => item.dict === 'cet4')
          if (!record) {
            transaction.abort()
            return
          }

          recordStore.put({
            ...record,
            index: makeDirty ? 0 : 3,
            isFinished: false,
            words: makeDirty ? record.words.slice(0, 2) : [
              { name: 'abandon', trans: ['放弃'], usphone: 'əˈbændən', ukphone: 'əˈbændən' },
              { name: 'ability', trans: ['能力'], usphone: 'əˈbɪləti', ukphone: 'əˈbɪləti' },
              { name: 'abroad', trans: ['在国外'], usphone: 'əˈbrɔːd', ukphone: 'əˈbrɔːd' },
              { name: 'absorb', trans: ['吸收'], usphone: 'əbˈzɔːrb', ukphone: 'əbˈzɔːb' },
              { name: 'abandon', trans: ['放弃'], usphone: 'əˈbændən', ukphone: 'əˈbændən' },
            ],
          })
        }

        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error || new Error('review fixture transaction aborted'))
      })
    } finally {
      database.close()
    }
  }, dirty)
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
        clientFormatVersion: current.clientFormatVersion || 'qwerty-dexie-gzip-v2',
      }),
    })

    if (!uploadedResponse.ok) {
      throw new Error(`PUT /api/sync failed with HTTP ${uploadedResponse.status}`)
    }

    return uploadedResponse.json() as Promise<{ revision: number }>
  })
}

test('real browser register, upload, divergence detection and download restore', async ({ page }) => {
  test.setTimeout(240_000)

  await openDataSettings(page)

  await page.getByPlaceholder('用户名').fill(username)
  await page.getByPlaceholder('密码（4-128字符）').fill(password)
  await page.getByPlaceholder('再次输入密码（仅注册）').fill(`${password}-mismatch`)
  await expect(page.getByText('两次输入的注册密码不一致。')).toBeVisible()
  await expect(page.getByRole('button', { name: '注册' })).toBeDisabled()

  await page.getByPlaceholder('再次输入密码（仅注册）').fill(password)
  await expect(page.getByRole('button', { name: '注册' })).toBeEnabled()
  await page.getByRole('button', { name: '注册' }).click()

  await expect(page.getByText(`账号：${username}`)).toBeVisible()
  await expect(page.getByText('云端 revision：')).toContainText('0')
  await addReviewCloudFixture(page)
  await page.evaluate(() => {
    localStorage.setItem('currentDict', JSON.stringify('cet4'))
    localStorage.setItem('currentChapter', JSON.stringify(7))
  })
  await page.getByRole('button', { name: '刷新状态' }).click()
  await expect(page.getByText('本地有未上传修改')).toBeVisible()

  await page.getByRole('button', { name: '上传本地数据' }).click()
  await expect(page.getByText('已上传到云端 revision 1。')).toBeVisible()
  await expect(page.getByText('本地与云端一致')).toBeVisible()

  const originalUserId = await page.evaluate(() => {
    const raw = localStorage.getItem('qwerty.cloudAuth.v1')
    if (!raw) throw new Error('missing auth before duplicate registration check')
    return (JSON.parse(raw) as { user: { userId: string } }).user.userId
  })

  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByRole('button', { name: '注册' })).toBeVisible()

  const duplicatePassword = `${password}-duplicate`
  await page.getByPlaceholder('用户名').fill(username.toUpperCase())
  await page.getByPlaceholder('密码（4-128字符）').fill(duplicatePassword)
  await page.getByPlaceholder('再次输入密码（仅注册）').fill(duplicatePassword)
  await page.getByRole('button', { name: '注册' }).click()

  await expect(page.getByText('用户名已存在，请直接登录。')).toBeVisible()
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible()

  await page.getByPlaceholder('用户名').fill(username)
  await page.getByPlaceholder('密码（4-128字符）').fill(password)
  await page.getByPlaceholder('再次输入密码（仅注册）').fill(password)
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page.getByText(`账号：${username}`)).toBeVisible()
  await expect(page.getByText('云端 revision：')).toContainText('1')

  const userIdAfterDuplicateRegister = await page.evaluate(() => {
    const raw = localStorage.getItem('qwerty.cloudAuth.v1')
    if (!raw) throw new Error('missing auth after duplicate registration check')
    return (JSON.parse(raw) as { user: { userId: string } }).user.userId
  })
  expect(userIdAfterDuplicateRegister).toBe(originalUserId)

  const reviewFixtureBefore = await readReviewCloudFixture(page)
  expect(reviewFixtureBefore.wordRecord).toMatchObject({
    word: 'edgeone-e2e-baseline',
    dict: 'cet4',
    chapter: -1,
    wrongCount: 2,
    mistakes: { 1: ['x', 'c'] },
    typingTelemetry: {
      telemetryVersion: 2,
      firstKeyLatencyMs: 850,
      backgroundPauseMs: 1200,
      backgroundPauseCount: 1,
    },
    learningContext: {
      version: 1,
      answerVisibilityAtStart: 'hidden',
      pronunciationPlayed: true,
      pronunciationPlayedBeforeFirstKey: true,
    },
  })
  expect(reviewFixtureBefore.reviewWordState).toMatchObject({
    dict: 'cet4',
    word: 'edgeone-e2e-baseline',
    reviewCount: 4,
    lapseCount: 2,
    cleanStreak: 1,
    lastOutcome: 'hard',
    stateVersion: 3,
    schedulerState: {
      kind: 'basic-v1',
      stage: 2,
      intervalDays: 7,
    },
  })
  expect(reviewFixtureBefore.reviewRecord).toMatchObject({
    dict: 'cet4',
    index: 3,
    isFinished: false,
  })
  expect(reviewFixtureBefore.reviewRecord.words.map((word: { name: string }) => word.name)).toEqual([
    'abandon',
    'ability',
    'abroad',
    'absorb',
    'abandon',
  ])

  // A Review-only mutation must participate in the whole-DB dirty fingerprint.
  await mutateReviewCloudFixture(page, true)
  await page.getByRole('button', { name: '刷新状态' }).click()
  await expect(page.getByText('本地有未上传修改')).toBeVisible()

  await mutateReviewCloudFixture(page, false)
  await page.getByRole('button', { name: '刷新状态' }).click()
  await expect(page.getByText('本地与云端一致')).toBeVisible()

  const gzipRemote = await page.evaluate(async () => {
    const rawAuth = localStorage.getItem('qwerty.cloudAuth.v1')
    if (!rawAuth) throw new Error('missing cloud auth state')
    const auth = JSON.parse(rawAuth) as { token: string }
    const response = await fetch('/api/sync', {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
    if (!response.ok) throw new Error(`GET /api/sync failed with HTTP ${response.status}`)
    const snapshot = (await response.json()) as {
      clientFormatVersion: string
      payloadBase64: string
    }

    const binary = atob(snapshot.payloadBase64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }

    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    const json = await new Response(stream).text()

    const parsed = JSON.parse(json) as {
      backupFormatVersion?: string
      learningState?: { currentDict?: string; currentChapter?: number }
    }

    return {
      clientFormatVersion: snapshot.clientFormatVersion,
      json,
      backupFormatVersion: parsed.backupFormatVersion,
      learningState: parsed.learningState,
    }
  })

  expect(gzipRemote.clientFormatVersion).toBe('qwerty-backup-v3')
  expect(gzipRemote.backupFormatVersion).toBe('qwerty-backup-v3')
  expect(gzipRemote.learningState).toEqual({ currentDict: 'cet4', currentChapter: 7 })
  expect(gzipRemote.json).toContain('edgeone-e2e-baseline')
  expect(gzipRemote.json).not.toContain('AES-256-GCM')

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

  expect(await wordRecordCount(page)).toBe(2)
  expect(await readReviewCloudFixture(page)).toEqual(reviewFixtureBefore)

  // Corrupt both Review state and the local learning position before restore.
  // The v3 cloud snapshot must restore scheduler/session semantics plus learning position.
  await mutateReviewCloudFixture(page, true)
  await page.evaluate(() => {
    localStorage.setItem('currentDict', JSON.stringify('zhongkaohexin'))
    localStorage.setItem('currentChapter', JSON.stringify(0))
  })

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '使用云端数据' }).click()

  await expect(page.getByText('已恢复云端 revision 2，词库和章节位置已同步。')).toBeVisible()
  await expect(page.getByText('本地与云端一致')).toBeVisible()
  expect(await wordRecordCount(page)).toBe(1)

  const restoredLearningState = await page.evaluate(() => ({
    currentDict: JSON.parse(localStorage.getItem('currentDict') || 'null'),
    currentChapter: JSON.parse(localStorage.getItem('currentChapter') || 'null'),
  }))
  expect(restoredLearningState).toEqual({ currentDict: 'cet4', currentChapter: 7 })

  const reviewFixtureAfterRestore = await readReviewCloudFixture(page)
  expect(reviewFixtureAfterRestore).toEqual(reviewFixtureBefore)
  expect(reviewFixtureAfterRestore.reviewWordState.schedulerState).toEqual({
    kind: 'basic-v1',
    stage: 2,
    intervalDays: 7,
  })
  expect(reviewFixtureAfterRestore.reviewRecord.index).toBe(3)
  expect(reviewFixtureAfterRestore.reviewRecord.words[4].name).toBe('abandon')

  const authBeforeDelete = await page.evaluate(() => {
    const raw = localStorage.getItem('qwerty.cloudAuth.v1')
    if (!raw) throw new Error('missing auth before delete')
    const auth = JSON.parse(raw) as { token: string; user: { userId: string } }
    return {
      token: auth.token,
      userId: auth.user.userId,
      baseline: localStorage.getItem(`qwerty.cloudSyncState.v1.${auth.user.userId}`),
    }
  })
  expect(authBeforeDelete.baseline).not.toBeNull()

  await page.getByPlaceholder('输入当前账号密码确认删除').fill(password)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '永久删除云端账号' }).click()

  await expect(
    page.getByText('云端账号及其全部云端数据已删除；本机学习数据已保留。'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
  expect(await wordRecordCount(page)).toBe(1)

  const localAfterDelete = await page.evaluate((userId) => {
    return {
      auth: localStorage.getItem('qwerty.cloudAuth.v1'),
      baseline: localStorage.getItem(`qwerty.cloudSyncState.v1.${userId}`),
    }
  }, authBeforeDelete.userId)
  expect(localAfterDelete.auth).toBeNull()
  expect(localAfterDelete.baseline).toBeNull()

  const oldTokenCheck = await page.evaluate(async (token) => {
    const response = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    return {
      status: response.status,
      body: await response.json(),
    }
  }, authBeforeDelete.token)
  expect(oldTokenCheck.status).toBe(401)
  expect((oldTokenCheck.body as { error?: string }).error).toBe('invalid_token')
})
