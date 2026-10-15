import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

// This is a customer-facing brand gate, NOT a blanket historical search.
// Historical Alpha release snapshots and lowercase math identifiers (alpha,
// ewmaAlpha, boundedAlpha) are intentional and must not be renamed.
const extensions = new Set(['.tsx', '.jsx', '.ts', '.js', '.css', '.html', '.json'])
const files = ['index.html', 'README.md', 'docs/BETA_USER_GUIDE_ZH.md',
  'docs/CLOUD_SYNC_USER_GUIDE.md', 'docs/LEARN_USER_GUIDE_V1.md']
const visit = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) visit(p)
    else if (extensions.has(extname(p))) files.push(p)
  }
}
visit('src')
visit('public')
const violations = []
for (const file of files) {
  const body = readFileSync(file, 'utf8')
  const lines = body.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    // Source-level Alpha stage labels or obsolete release version. Do not
    // treat algorithmic "alpha" as a product release identifier.
    if (/\bAlpha\b|0\.2\.0-alpha\./.test(lines[i])) {
      violations.push(`${file}:${i+1}: ${lines[i].trim().slice(0,140)}`)
    }
  }
}
if (violations.length) {
  console.error('FAIL: live Beta pages or active guides still expose Alpha:\n' +
    violations.join('\n'))
  process.exitCode = 1
} else console.log('PASS: no Alpha stage labels in', files.length, 'live UI/public/active documentation files')

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
assert.equal(pkg.version, '0.2.0-beta.1')
const readme = readFileSync('README.md', 'utf8')
assert.match(readme, /QWERTY Plus.*Beta/)
assert.match(readme, /qwerty-backup-v4/)
assert.doesNotMatch(readme, /qwerty-backup-v3|0\.2\.0-alpha|手动上传\/下载|手工上传\/下载/)
assert.match(readFileSync('src/components/Footer/index.tsx','utf8'), /Qwerty Plus Beta/)
assert.match(readFileSync('src/pages/Typing/components/ShareButton/SharePicDialog.tsx','utf8'), /Learn Beta/)
assert.match(readFileSync('docs/CLOUD_SYNC_USER_GUIDE.md','utf8'), /qwerty-backup-v4/)
console.log('PASS: Beta version, public copy and V4 README/docs contracts')
