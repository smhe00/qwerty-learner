import base from '../../vite.config'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, mergeConfig } from 'vite'
export default defineConfig(async env => mergeConfig(typeof base === 'function' ? await base(env) : await base, {
  // Isolated cache and explicit dependency directory for Windows worktree junctions.
  cacheDir: resolve(process.cwd(), 'blob-report/feedback/vite-cache'),
  server: { fs: { allow: [process.cwd(), realpathSync(resolve(process.cwd(), 'node_modules'))] } },
}))
