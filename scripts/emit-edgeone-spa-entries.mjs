/* eslint-env node */
/**
 * Maker's current static host does not reliably apply edgeone.json SPA
 * rewrites: /learn and /learn/ previously returned HTTP 404 even though
 * the root app rendered. Publish physical HTML entry points for the known
 * public client routes, without touching /api or /source-commit.txt.
 *
 * GitHub Pages uses its own /?/ redirect fallback; never create route
 * directories when building a pages-specific artifact.
 */
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

if (process.env.REACT_APP_DEPLOY_ENV === 'pages') {
  console.log('GitHub Pages: preserve existing SPA 404 behavior')
} else {
  const buildDir = path.resolve('build')
  const entry = path.join(buildDir, 'index.html')
  const html = await readFile(entry, 'utf8')
  if (!html.includes('id="root"')) {
    throw new Error('Unexpected Vite root document; refusing to publish SPA route copies')
  }
  const routes = [
    'typing', 'learn', 'analysis', 'gallery',
    'achievements', 'error-book', 'friend-links', 'mobile',
    'mobile/study', 'mobile/account', 'mobile/library', 'mobile/settings',
  ]
  for (const route of routes) {
    const folder = path.join(buildDir, route)
    await mkdir(folder, { recursive: true })
    await copyFile(entry, path.join(folder, 'index.html'))
  }
  console.log('EdgeOne SPA physical route entries:', routes.join(', '))
}
