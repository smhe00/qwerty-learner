/** Global resets belong to document entries, never to lazy feature modules.
 * Run after the production build so CSS extraction/order is part of the gate. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(file) : [file]
  })
const globalCSS = path.resolve('src/index.css')
const owners = new Set(['src/index.tsx', 'src/song-preview/entry.tsx'])
const found = new Set()
for (const file of walk('src').filter((file) => /\.(tsx?|jsx?|css)$/.test(file))) {
  const source = fs.readFileSync(file, 'utf8')
  for (const match of source.matchAll(
    /(?:import\s*(?:[^'";\n]*from\s*)?|import\s*\(|require\s*\(|@import\s*(?:url\(\s*)?)['"]([^'"]+\.css(?:\?[^'"]*)?)['"]/g,
  )) {
    const specifier = match[1].split('?')[0]
    const target = specifier.startsWith('@/') ? path.resolve('src', specifier.slice(2)) : path.resolve(path.dirname(file), specifier)
    if (target !== globalCSS) continue
    assert(owners.has(file), `Global CSS imported by lazy feature: ${file}`)
    found.add(file)
  }
  if (/@tailwind\s+base\b/.test(source)) assert.equal(path.resolve(file), globalCSS, `Duplicate Tailwind reset: ${file}`)
}
assert.deepEqual([...found].sort(), [...owners].sort(), 'Every document entry must load the global stylesheet')
const lock = fs.readFileSync('yarn.lock', 'utf8')
const lockedTailwind = lock.match(/tailwindcss@\^3\.3\.1:\n\s+version "([^"]+)"/)?.[1]
assert(lockedTailwind, 'Cannot identify locked Tailwind version')
assert.equal(
  require('tailwindcss/package.json').version,
  lockedTailwind,
  'Tailwind differs from yarn.lock; CSS results would not represent CI',
)
const css = walk('build').filter((file) => file.endsWith('.css'))
const resetAssets = css.filter((file) => /-webkit-appearance:button;background-color:transparent/.test(fs.readFileSync(file, 'utf8')))
assert.equal(resetAssets.length, 1, 'Global reset must exist in exactly one shared entry CSS asset')
const resetFile = path.basename(resetAssets[0])
// The separate Song-complete museum owns its own standalone CSS, no reset.
for (const html of ['build/index.html']) {
  const head = fs.readFileSync(html, 'utf8').split('</head>')[0]
  assert(head.includes(resetFile), `${html} must load the global reset before lazy feature CSS`)
}
console.log(`UI CSS ownership PASS: ${found.size} document entries; reset ${resetFile}; Tailwind ${lockedTailwind}`)
