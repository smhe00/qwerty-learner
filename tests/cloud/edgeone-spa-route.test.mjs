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

test('EdgeOne defensive 404 preserves known SPA paths without growing legacy queries', () => {
  const origin = 'https://qwerty-plus.edgeone.dev'
  assert.equal(runNotFoundPage(origin + '/learn/'),
    origin + '/?qwerty-route=%2Flearn')
  assert.equal(
    runNotFoundPage(origin + '/learn/?/&/~and~/~and~/~and~/'),
    origin + '/?qwerty-route=%2Flearn',
  )
  assert.equal(
    runNotFoundPage(origin + '/analysis?from=learn'),
    origin + '/?qwerty-route=%2Fanalysis%3Ffrom%3Dlearn',
  )
  assert.equal(runNotFoundPage(origin + '/api/unknown'), origin + '/')
  assert.equal(runNotFoundPage(origin + '/assets/missing.js'), origin + '/')
  assert.equal(runNotFoundPage(origin + '/'), null)
  assert.equal(runNotFoundPage(origin + '/?/~and~'), null)
})

test('GitHub Pages 404 deep-link fallback remains available', () => {
  assert.equal(
    runNotFoundPage('https://smhe00.github.io/qwerty-learner/learn'),
    'https://smhe00.github.io/qwerty-learner/?/learn',
  )
})


const indexHtml = readFileSync(join(root, 'index.html'), 'utf8')
const indexScript = indexHtml.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)?.[1]

function runIndexBoot(href) {
  assert.ok(indexScript, 'SPA route bootstrap script must exist')
  const url = new URL(href)
  let route = null
  const location = {
    hostname: url.hostname,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  }
  const history = {
    state: { from: 'test' },
    replaceState(_state, _title, path) { route = path },
  }
  vm.runInNewContext(indexScript, { window: { location, history } })
  return route
}

test('EdgeOne consumes recovery marker before React routing and retains deep-link query', () => {
  const origin = 'https://qwerty-plus.edgeone.dev'
  const rescued = runNotFoundPage(origin + '/analysis?from=learn')
  assert.equal(runIndexBoot(rescued), '/analysis?from=learn')
  assert.equal(runIndexBoot(runNotFoundPage(origin + '/learn/')), '/learn')
  assert.equal(runIndexBoot(origin + '/?qwerty-route=%2F%2Fevil.example'), '/')
  assert.equal(runIndexBoot(origin + '/?qwerty-route=%ZZ'), '/')
  assert.equal(runIndexBoot(origin + '/?qwerty-route=%2Fapi%2Fhealth'), '/')
})

test('EdgeOne repairs an already-growing /learn/ query without changing its route', () => {
  assert.equal(
    runIndexBoot('https://qwerty-plus.edgeone.dev/learn/?/&/~and~/~and~/'),
    '/learn',
  )
  assert.equal(
    runIndexBoot('https://qwerty-plus.edgeone.dev/learn/?s1-account=manage'),
    null,
  )
  assert.equal(
    runIndexBoot('https://qwerty-plus.edgeone.dev/learn/'),
    null,
  )
})

test('GitHub Pages retains the original encoded deep-link decoder', () => {
  assert.equal(
    runIndexBoot('https://smhe00.github.io/qwerty-learner/?/learn'),
    '/qwerty-learner/learn',
  )
})
