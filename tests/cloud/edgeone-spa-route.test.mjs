import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'

const root = process.cwd()
const config = JSON.parse(readFileSync(join(root, 'edgeone.json'), 'utf8'))
const html = readFileSync(join(root, 'public/404.html'), 'utf8')
const script = html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)?.[1]

function runNotFoundPage(href) {
  assert.ok(script, 'GitHub Pages compatibility script must exist')
  const url = new URL(href)
  let next = null
  const location = {
    origin: url.origin,
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    replace(href) { next = href },
  }
  vm.runInNewContext(script, { window: { location } })
  return next
}

test('EdgeOne explicitly rewrites SPA deep links to index.html', () => {
  assert.deepEqual(
    config.rewrites?.find((entry) => entry.source === '/*'),
    { source: '/*', destination: '/index.html' },
  )
})

test('EdgeOne stale 404 never expands /learn/?/&/~and~ on repeated refresh', () => {
  const origin = 'https://qwerty-plus.edgeone.dev'
  assert.equal(runNotFoundPage(origin + '/learn/'), origin + '/')
  assert.equal(
    runNotFoundPage(origin + '/learn/?/&/~and~/~and~/~and~/'),
    origin + '/',
  )
  assert.equal(runNotFoundPage(origin + '/'), null)
  // Defensive fallback cannot loop even when the request is already malformed.
  assert.equal(runNotFoundPage(origin + '/?/~and~'), null)
})

test('GitHub Pages 404 deep-link fallback remains available', () => {
  assert.equal(
    runNotFoundPage('https://smhe00.github.io/qwerty-learner/learn'),
    'https://smhe00.github.io/qwerty-learner/?/learn',
  )
})
