import {
  expect,
  test,
  type Page,
} from '@playwright/test'
import {
  generateP3BrowserActions,
  minimizeP3ActionSequence,
  type P3BrowserAction,
} from './browser-stateful-fuzz-core'

type FuzzWord = {
  name: string
  trans: string[]
  usphone: string
  ukphone: string
}

const fuzzWords: FuzzWord[] = [
  {
    name: 'cancel',
    trans: ['取消'],
    usphone: 'kænsl',
    ukphone: 'kænsl',
  },
  {
    name: 'explosive',
    trans: ['爆炸的'],
    usphone: 'ɪksplosɪv',
    ukphone: 'ɪkspləusɪv',
  },
  {
    name: 'numerous',
    trans: ['众多的'],
    usphone: 'numərəs',
    ukphone: 'njuːmərəs',
  },
  {
    name: 'govern',
    trans: ['统治'],
    usphone: 'ɡʌvɚn',
    ukphone: 'gʌvn',
  },
  {
    name: 'analyse',
    trans: ['分析'],
    usphone: 'ænəlaɪz',
    ukphone: 'ænəlaɪz',
  },
]

function exercisePlan() {
  return {
    version: 1,
    condition: {
      version: 1,
      purpose: 'probe',
      source: 'adaptive-policy',
      audio: 'none',
      meaning: 'visible',
      phonetic: 'hidden',
      letters: { mode: 'all-hidden' },
      probeDimension: 'none',
    },
    decision: {
      version: 1,
      policyVersion: 'canonical-review-probe-v1',
      reasonCodes: ['p3-browser-fuzz'],
      conditionVersion: 1,
    },
    sourceShadowVersion: 1,
  }
}

function makeSession(id: number) {
  return {
    id,
    dict: 'cet4',
    createTime: id,
    index: 0,
    isFinished: false,
    sessionKind: 'review',
    words: fuzzWords,
    exercisePlans: Object.fromEntries(
      fuzzWords.map((word) => [
        word.name,
        exercisePlan(),
      ]),
    ),
    recommendedGoal: {
      version: 1,
      kind: 'session-completion',
      targetUniqueWords: fuzzWords.length,
    },
  }
}

async function installCleanFuzzHooks(page: Page) {
  await page.addInitScript(() => {
    ;(
      window as Window & {
        __QWERTY_P3_TEST_HOOKS__?: {
          gates?: Record<string, boolean>
          faults?: Record<string, boolean>
        }
      }
    ).__QWERTY_P3_TEST_HOOKS__ = {
      gates: {},
      faults: {},
    }
    localStorage.setItem(
      'developerDiagnosticsConfig',
      JSON.stringify({ isOpen: true }),
    )
  })
}

async function resetAndSeed(
  page: Page,
  id: number,
) {
  await page.goto('/typing')
  const session = makeSession(id)

  await page.evaluate(async (seededSession) => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem(
      'developerDiagnosticsConfig',
      JSON.stringify({ isOpen: true }),
    )
    localStorage.setItem(
      'currentDict',
      JSON.stringify('cet4'),
    )
    localStorage.setItem(
      'currentChapter',
      JSON.stringify(-1),
    )
    localStorage.setItem(
      'loopWordConfig',
      JSON.stringify({ times: 1 }),
    )
    localStorage.setItem(
      'pronunciation',
      JSON.stringify({
        isOpen: false,
        volume: 1,
        type: 'us',
        name: '美音',
        isLoop: false,
        isTransRead: false,
        transVolume: 1,
        rate: 1,
      }),
    )
    localStorage.setItem(
      'reviewModeInfo',
      JSON.stringify({
        isReviewMode: true,
        reviewRecord: seededSession,
      }),
    )

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const stores = [
          'reviewRecords',
          'wordRecords',
          'reviewWordStates',
        ].filter((name) =>
          db.objectStoreNames.contains(name),
        )
        const tx = db.transaction(stores, 'readwrite')
        for (const name of stores) {
          tx.objectStore(name).clear()
        }
        tx.objectStore('reviewRecords').put(seededSession)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }
    })
  }, session)

  await page.goto('/learn/session')
  await expect(page).toHaveURL(/\/learn\/session$/)
  await expect(
    page.locator('[data-typing-word]').first(),
  ).toBeVisible()
}

async function readRouteState(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('reviewModeInfo')
    const info = raw ? JSON.parse(raw) : undefined
    return {
      path: location.pathname,
      record: info?.reviewRecord,
    }
  })
}

async function readDurableRecord(
  page: Page,
  id: number,
) {
  return page.evaluate(async (recordId) => {
    return new Promise<Record<string, unknown> | undefined>(
      (resolve, reject) => {
        const request = indexedDB.open('RecordDB')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction(
            'reviewRecords',
            'readonly',
          )
          const get = tx
            .objectStore('reviewRecords')
            .get(recordId)
          get.onerror = () => reject(get.error)
          get.onsuccess = () => {
            resolve(get.result)
            db.close()
          }
        }
      },
    )
  }, id)
}

async function readWordRecordCount(page: Page) {
  return page.evaluate(async () => {
    return new Promise<number>((resolve, reject) => {
      const request = indexedDB.open('RecordDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(
          'wordRecords',
          'readonly',
        )
        const count = tx
          .objectStore('wordRecords')
          .count()
        count.onerror = () => reject(count.error)
        count.onsuccess = () => {
          resolve(count.result)
          db.close()
        }
      }
    })
  })
}

async function ensureTypingStarted(page: Page) {
  const prompt = page.getByText('按任意键开始')
  if (await prompt.isVisible().catch(() => false)) {
    await page.keyboard.press('a')
  }
}

async function completeCurrent(page: Page) {
  const result = page.locator('[data-learn-result-screen]')
  if (await result.isVisible().catch(() => false)) return

  const wordNode = page.locator('[data-typing-word]').first()
  if (!(await wordNode.isVisible().catch(() => false))) return

  await ensureTypingStarted(page)
  const word = await wordNode.getAttribute('data-typing-word')
  if (!word) return

  const before = await readRouteState(page)
  await page.keyboard.type(word)

  await expect
    .poll(async () => {
      const after = await readRouteState(page)
      return (
        after.record?.isFinished === true ||
        after.record?.index !== before.record?.index
      )
    })
    .toBe(true)

  // Durable progress happens before the success-feedback animation releases
  // the next word. A stateful fuzzer must not treat input during that locked
  // presentation window as a failed Learn transition.
  await expect
    .poll(async () => {
      const after = await readRouteState(page)
      if (after.record?.isFinished === true) {
        return true
      }

      const next = page.locator('[data-typing-word]').first()
      if (!(await next.isVisible().catch(() => false))) {
        return false
      }
      const nextWord = await next.getAttribute(
        'data-typing-word',
      )
      const locked = await next.getAttribute(
        'data-typing-locked',
      )
      const finished = await next.getAttribute(
        'data-typing-finished',
      )
      return (
        nextWord !== word &&
        locked !== 'true' &&
        finished !== 'true'
      )
    })
    .toBe(true)
}

async function routeCycle(page: Page) {
  const route = await readRouteState(page)
  if (route.record?.isFinished) return

  const typing = page.getByRole('button', {
    name: 'Typing',
    exact: true,
  })
  if (!(await typing.isVisible().catch(() => false))) return
  await typing.click()
  await expect(page).toHaveURL(/\/typing$/)

  const learn = page.getByRole('button', {
    name: 'Learn',
    exact: true,
  })
  await learn.click()

  await expect
    .poll(() => new URL(page.url()).pathname)
    .toMatch(/\/learn(?:\/session)?$/)

  await expect
    .poll(async () => {
      const state = await readRouteState(page)
      return (
        state.record?.isFinished === true ||
        state.path === '/learn/session'
      )
    })
    .toBe(true)
}

type InvariantState = {
  sessionId?: number
  maxIndex: number
  terminalWordRecordCount?: number
}

async function assertBrowserInvariants(
  page: Page,
  state: InvariantState,
) {
  const route = await readRouteState(page)
  const record = route.record
  const activeWordVisible = await page
    .locator('[data-typing-word]')
    .first()
    .isVisible()
    .catch(() => false)

  if (record?.id === state.sessionId) {
    expect(
      record.index,
      'persisted Learn index must never regress',
    ).toBeGreaterThanOrEqual(state.maxIndex)
    state.maxIndex = Math.max(
      state.maxIndex,
      Number(record.index ?? 0),
    )
  }

  if (record?.isFinished === true) {
    expect(
      activeWordVisible,
      'finished session must never render an active word',
    ).toBe(false)

    const count = await readWordRecordCount(page)
    if (state.terminalWordRecordCount === undefined) {
      state.terminalWordRecordCount = count
    } else {
      expect(
        count,
        'non-typing lifecycle actions must not create post-finish evidence',
      ).toBe(state.terminalWordRecordCount)
    }
  } else if (activeWordVisible) {
    expect(route.path).toBe('/learn/session')
    expect(record?.isFinished).not.toBe(true)
  }
}

async function runAction(
  page: Page,
  action: P3BrowserAction,
) {
  if (action.kind === 'complete-current') {
    await completeCurrent(page)
    return
  }

  if (action.kind === 'reload') {
    await page.reload()
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toMatch(/\/learn(?:\/session)?$/)
    return
  }

  if (action.kind === 'resize') {
    const before = new URL(page.url()).pathname
    await page.setViewportSize({
      width: action.width,
      height: action.height,
    })
    expect(
      new URL(page.url()).pathname,
      'desktop resize must be presentation-only',
    ).toBe(before)
    return
  }

  if (action.kind === 'blur-focus') {
    const before = await readRouteState(page)
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('focus'))
    })
    const after = await readRouteState(page)
    expect(after.record?.index).toBe(
      before.record?.index,
    )
    expect(after.record?.isFinished).toBe(
      before.record?.isFinished,
    )
    return
  }

  await routeCycle(page)
}

async function runScenario(
  page: Page,
  seed: number,
  actions: P3BrowserAction[],
) {
  const id = 930000 + seed
  await resetAndSeed(page, id)
  const invariantState: InvariantState = {
    sessionId: id,
    maxIndex: 0,
  }
  const pageErrors: string[] = []
  const onPageError = (error: Error) => {
    pageErrors.push(error.message)
  }
  page.on('pageerror', onPageError)

  try {
    for (
      let actionIndex = 0;
      actionIndex < actions.length;
      actionIndex += 1
    ) {
      await runAction(page, actions[actionIndex])
      await assertBrowserInvariants(
        page,
        invariantState,
      )
      if (pageErrors.length > 0) {
        throw new Error(
          `browser pageerror: ${pageErrors.join(' | ')}`,
        )
      }
    }

    const final = await readRouteState(page)
    if (
      final.record?.id === id &&
      final.record?.isFinished !== true
    ) {
      await expect
        .poll(async () => {
          const durable = await readDurableRecord(page, id)
          return Number(durable?.index ?? -1)
        })
        .toBeGreaterThanOrEqual(
          Number(final.record.index ?? 0),
        )
    }
  } finally {
    page.off('pageerror', onPageError)
  }
}

async function configureHooks(
  page: Page,
  input: {
    gates?: Record<string, boolean>
    faults?: Record<string, boolean>
  },
) {
  await page.addInitScript((settings) => {
    ;(
      window as Window & {
        __QWERTY_P3_TEST_HOOKS__?: {
          gates?: Record<string, boolean>
          faults?: Record<string, boolean>
        }
      }
    ).__QWERTY_P3_TEST_HOOKS__ = settings
    localStorage.setItem(
      'developerDiagnosticsConfig',
      JSON.stringify({ isOpen: true }),
    )
  }, input)
}

async function releaseGate(
  page: Page,
  gate: string,
) {
  await page.evaluate((gateName) => {
    const target = (
      window as Window & {
        __QWERTY_P3_TEST_HOOKS__?: {
          gates?: Record<string, boolean>
        }
      }
    ).__QWERTY_P3_TEST_HOOKS__
    if (target?.gates) {
      target.gates[gateName] = false
    }
    window.dispatchEvent(
      new CustomEvent('qwerty:p3-fuzz-release', {
        detail: { gate: gateName },
      }),
    )
  }, gate)
}

async function waitForTraceEvent(
  page: Page,
  eventName: string,
) {
  await expect
    .poll(() =>
      page.evaluate((name) => {
        const raw = localStorage.getItem(
          'qwertyDeveloperTraceV1',
        )
        const events = raw ? JSON.parse(raw) : []
        return events.some(
          (event: { event?: string }) =>
            event.event === name,
        )
      }, eventName),
    )
    .toBe(true)
}

test('P3 action minimizer is deterministic and 1-minimizes a failing sequence', async () => {
  const source: P3BrowserAction[] = [
    { kind: 'reload' },
    { kind: 'blur-focus' },
    { kind: 'resize', width: 1100, height: 720 },
    { kind: 'complete-current' },
  ]
  const reproduces = async (
    candidate: P3BrowserAction[],
  ) =>
    candidate.some(
      (item) => item.kind === 'resize',
    ) &&
    candidate.some(
      (item) => item.kind === 'complete-current',
    )

  const first = await minimizeP3ActionSequence(
    source,
    reproduces,
  )
  const second = await minimizeP3ActionSequence(
    source,
    reproduces,
  )

  expect(first).toEqual(second)
  expect(first).toHaveLength(2)
  await expect(reproduces(first)).resolves.toBe(true)
})

test('P3 clean deterministic lifecycle fuzz keeps browser/session invariants', async ({
  page,
}) => {
  await installCleanFuzzHooks(page)

  const explicitSeed = process.env.P3_FUZZ_SEED
  const seedCount = Number(
    process.env.P3_FUZZ_SEEDS ?? 20,
  )
  const stepCount = Number(
    process.env.P3_FUZZ_STEPS ?? 5,
  )
  const seeds = explicitSeed
    ? [Number(explicitSeed)]
    : Array.from(
        { length: seedCount },
        (_, index) => index + 1,
      )

  for (const seed of seeds) {
    const actions = generateP3BrowserActions(
      seed,
      stepCount,
    )

    try {
      await runScenario(page, seed, actions)
    } catch (error) {
      console.error(
        'P3_BROWSER_FUZZ_FAILURE',
        JSON.stringify({
          seed,
          actions,
          message:
            error instanceof Error
              ? error.message
              : String(error),
        }),
      )

      if (process.env.P3_FUZZ_MINIMIZE === '1') {
        const minimized =
          await minimizeP3ActionSequence(
            actions,
            async (candidate) => {
              try {
                await runScenario(
                  page,
                  seed,
                  candidate,
                )
                return false
              } catch {
                return true
              }
            },
          )
        console.error(
          'P3_BROWSER_FUZZ_MINIMIZED',
          JSON.stringify({
            seed,
            original: actions.length,
            minimized: minimized.length,
            actions: minimized,
          }),
        )
      }

      throw error
    }
  }

  console.log(
    'P3_BROWSER_FUZZ_CLEAN',
    JSON.stringify({
      seeds,
      stepsPerSeed: stepCount,
      totalActions: seeds.length * stepCount,
    }),
  )
})

test('P3 detects stale Learn preparation stealing navigation ownership', async ({
  page,
}) => {
  await configureHooks(page, {
    gates: { 'learn-preparation': true },
    faults: {
      'stale-preparation-owns-navigation': true,
    },
  })

  await page.goto('/learn')
  await waitForTraceEvent(
    page,
    'p3-browser-fuzz-gate-wait',
  )

  await page
    .getByRole('button', {
      name: 'Typing',
      exact: true,
    })
    .click()
  await expect(page).toHaveURL(/\/typing$/)

  await releaseGate(page, 'learn-preparation')

  const stolen = await expect
    .poll(() => new URL(page.url()).pathname, {
      timeout: 8_000,
    })
    .toBe('/learn/session')
    .then(
      () => true,
      () => false,
    )

  expect(
    stolen,
    'fault injection must be observable by the navigation invariant',
  ).toBe(true)
})

test('P3 survives route-cache ahead of IndexedDB and refresh during checkpoint window', async ({
  page,
}) => {
  await configureHooks(page, {
    gates: { 'review-persistence': true },
    faults: {},
  })

  const id = 940001
  await resetAndSeed(page, id)
  await completeCurrent(page)

  const routeAhead = await readRouteState(page)
  expect(routeAhead.record?.index).toBe(1)

  const durableBehind = await readDurableRecord(
    page,
    id,
  )
  expect(durableBehind?.index).toBe(0)

  console.log(
    'P3_ROUTE_CACHE_IDB_DIVERGENCE',
    JSON.stringify({
      sessionId: id,
      routeIndex: routeAhead.record?.index,
      durableIndex: durableBehind?.index,
    }),
  )

  // Reload destroys the blocked old document before the asynchronous
  // IndexedDB checkpoint can run. Route-critical localStorage must preserve
  // the newer index and the next durable write must converge forward.
  await page.reload()
  await expect(page).toHaveURL(/\/learn\/session$/)
  const restored = await readRouteState(page)
  expect(restored.record?.index).toBe(1)

  await releaseGate(page, 'review-persistence')
  await completeCurrent(page)

  await expect
    .poll(async () => {
      const durable = await readDurableRecord(page, id)
      return Number(durable?.index ?? -1)
    })
    .toBeGreaterThanOrEqual(2)
})

test('P3 detects terminal desktop-resize navigation mutation', async ({
  page,
}) => {
  await configureHooks(page, {
    gates: {},
    faults: {
      'desktop-resize-navigates-root': true,
    },
  })

  const id = 940002
  await resetAndSeed(page, id)

  for (let index = 0; index < fuzzWords.length; index += 1) {
    await completeCurrent(page)
  }
  await expect(
    page.locator('[data-learn-result-screen]'),
  ).toBeVisible()

  const before = new URL(page.url()).pathname
  await page.setViewportSize({
    width: 1111,
    height: 731,
  })

  await expect
    .poll(() => new URL(page.url()).pathname)
    .not.toBe(before)

  const activeWord = await page
    .locator('[data-typing-word]')
    .first()
    .isVisible()
    .catch(() => false)
  expect(activeWord).toBe(false)
})
