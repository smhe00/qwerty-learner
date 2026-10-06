import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// Guard for TASK-20261006-006.
//
// `src/resources/soundResource.ts` cannot be imported here directly: it uses
// Vite-only `import.meta.glob` and the injected `REACT_APP_DEPLOY_ENV` global.
// The prefixes are therefore asserted from source with an explicit shape
// contract, so a silent return to a document-relative prefix fails fast without
// needing a browser.
//
// The browser-level proof that both Learn feedback sounds actually play lives in
// `tests/e2e/learn-audio-regression.spec.ts`.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const source = readFileSync(path.join(repoRoot, 'src/resources/soundResource.ts'), 'utf8')

const DECLARATION =
  /export const SOUND_URL_PREFIX\s*=\s*REACT_APP_DEPLOY_ENV\s*===\s*'pages'\s*\?\s*'([^']*)'\s*:\s*'([^']*)'/

function readPrefixes() {
  const match = source.match(DECLARATION)
  assert.ok(
    match,
    'SOUND_URL_PREFIX declaration not found in src/resources/soundResource.ts. ' +
      'Update this guard if the declaration shape intentionally changed.',
  )
  return { pagesPrefix: match[1], defaultPrefix: match[2] }
}

test('default sound prefix resolves to the app root from a nested Learn route', () => {
  const { defaultPrefix } = readPrefixes()

  assert.ok(
    !defaultPrefix.startsWith('.'),
    `sound prefix must be app-root absolute, got "${defaultPrefix}"`,
  )

  // Learn renders its session on /learn/session. A document-relative prefix
  // resolves against that path and 404s every feedback sound.
  for (const route of ['/', '/learn/session', '/typing', '/learn']) {
    const resolved = new URL(defaultPrefix, `http://app${route}`)
    assert.equal(
      resolved.pathname,
      '/sounds/',
      `"${defaultPrefix}" resolved to "${resolved.pathname}" from route "${route}"`,
    )
  }
})

test('pages sound prefix is absolute and matches the Vite base', () => {
  const { pagesPrefix } = readPrefixes()

  assert.ok(!pagesPrefix.startsWith('.'), `pages sound prefix must be absolute, got "${pagesPrefix}"`)

  for (const route of ['/', '/learn/session', '/typing']) {
    const resolved = new URL(pagesPrefix, `http://app${route}`)
    assert.equal(
      resolved.pathname,
      '/qwerty-learner/sounds/',
      `"${pagesPrefix}" resolved to "${resolved.pathname}" from route "${route}"`,
    )
  }
})

test('no document-relative sound prefix remains anywhere in the sound resource module', () => {
  const relative = source.match(/['"]\.\/sounds\//)
  assert.equal(
    relative,
    null,
    'found a document-relative "./sounds/" prefix; Learn routes would resolve it to /learn/sounds/ and 404',
  )
})
