/* eslint-env node */
import crypto from 'node:crypto'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function expectError(fn, code) {
  try {
    await fn()
  } catch (error) {
    assert(error && error.code === code, `Expected ${code}, got ${error && error.code}`)
    return
  }

  throw new Error(`Expected ${code}, operation succeeded`)
}

function payload(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
}

export async function runBackendSelfTest(service) {
  const username = `test_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`
  const password1 = `Test-A9-${crypto.randomBytes(8).toString('hex')}`
  const password2 = `Test-B7-${crypto.randomBytes(8).toString('hex')}`
  const steps = []
  const pass = (name) => steps.push({ name, ok: true })

  let userId = null
  let primaryError = null
  let cleanup = null

  try {
    const registered = await service.register(username, password1, 'register-device')
    userId = registered.user.userId
    assert(registered.token, 'register token missing')
    pass('register')

    const registrationMe = await service.me(registered.token)
    assert(registrationMe.user.userId === userId, 'registration session invalid')
    pass('registration-session-valid')

    await expectError(() => service.register(username, password1), 'username_taken')
    pass('duplicate-register-rejected')

    await expectError(
      () => service.login(username, 'Definitely-Wrong-Password'),
      'invalid_credentials',
    )
    pass('wrong-password-rejected')

    const login1 = await service.login(username, password1, 'device-a')
    pass('first-login')

    await expectError(() => service.me(registered.token), 'session_revoked')
    pass('registration-session-revoked')

    const login2 = await service.login(username, password1, 'device-b')
    pass('second-login')

    await expectError(() => service.me(login1.token), 'session_revoked')
    pass('first-login-revoked')

    const me = await service.me(login2.token)
    assert(me.user.userId === userId, 'auth/me mismatch')
    assert(me.session.deviceId === 'device-b', 'latest device id mismatch')
    pass('auth-me-latest-session')

    const empty = await service.syncMeta(login2.token)
    assert(empty.revision === 0 && empty.hasData === false, 'new account must start at revision 0')
    pass('sync-meta-empty')

    const p1 = payload({ generation: 1, words: ['receive', 'necessary'] })
    const r1 = await service.putSync(login2.token, {
      baseRevision: 0,
      payloadBase64: p1,
      deviceId: 'device-b',
      clientFormatVersion: 'test-v1',
    })
    assert(r1.revision === 1, 'first revision must be 1')
    pass('sync-upload-revision-1')

    const d1 = await service.getSync(login2.token)
    assert(d1.revision === 1 && d1.payloadBase64 === p1, 'revision 1 download mismatch')
    pass('sync-download-revision-1')

    await expectError(
      () =>
        service.putSync(login2.token, {
          baseRevision: 0,
          payloadBase64: payload({ stale: true }),
        }),
      'sync_conflict',
    )
    pass('sync-conflict-detected')

    const p2 = payload({ generation: 2, words: ['receive', 'necessary', 'environment'] })
    const r2 = await service.putSync(login2.token, {
      baseRevision: 1,
      payloadBase64: p2,
      deviceId: 'device-b',
      clientFormatVersion: 'test-v1',
    })
    assert(r2.revision === 2, 'second revision must be 2')
    pass('sync-upload-revision-2')

    let latestPayload = p2
    let latestRevision = 2

    for (let generation = 3; generation <= 5; generation += 1) {
      latestPayload = payload({
        generation,
        words: ['receive', 'necessary', 'environment', `word-${generation}`],
      })

      const result = await service.putSync(login2.token, {
        baseRevision: latestRevision,
        payloadBase64: latestPayload,
        deviceId: 'device-b',
        clientFormatVersion: 'test-v1',
      })

      latestRevision = generation
      assert(result.revision === latestRevision, `revision ${generation} mismatch`)
    }
    pass('sync-advances-through-revision-5')

    const changed = await service.changePassword(
      login2.token,
      password1,
      password2,
      'device-b',
    )
    assert(changed.token, 'password change token missing')
    pass('change-password')

    await expectError(() => service.me(login2.token), 'session_revoked')
    pass('pre-change-session-revoked')

    await expectError(() => service.login(username, password1), 'invalid_credentials')
    pass('old-password-rejected')

    const login3 = await service.login(username, password2, 'device-c')
    pass('new-password-login')

    await expectError(() => service.me(changed.token), 'session_revoked')
    pass('password-change-session-revoked-by-new-login')

    const after = await service.getSync(login3.token)
    assert(
      after.revision === latestRevision && after.payloadBase64 === latestPayload,
      'sync must survive password change',
    )
    pass('sync-survives-password-change')

    await expectError(() => service.me('not-a-session-token'), 'invalid_token')
    pass('malformed-token-rejected')
  } catch (error) {
    primaryError = error
  }

  try {
    cleanup = await service.cleanupTestUser(username)
    steps.push({ name: 'cleanup', ok: true, details: cleanup })
  } catch (error) {
    steps.push({ name: 'cleanup', ok: false, details: { message: error.message } })
    if (!primaryError) primaryError = error
  }

  if (primaryError) throw primaryError

  return {
    success: true,
    username,
    userId,
    stepCount: steps.length,
    steps,
    cleanup,
  }
}
