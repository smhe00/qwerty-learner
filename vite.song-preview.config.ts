import react from '@vitejs/plugin-react'
import path from 'node:path'
import { copyFileSync, mkdirSync } from 'node:fs'
import { defineConfig } from 'vite'

/** Safe read-only Song Achievement demo: separate HTML entry, no S1 boot or Dexie imports. */
export default defineConfig({
  root: path.resolve(__dirname, 'preview/song-achievements'),
  base: '/qwerty-learner/previews/song-achievements/',
  plugins: [react(), {
    name: 'copy-song-fog-bitmaps',
    closeBundle() {
      const assets = ['far-light', 'near-light', 'far-dark', 'near-dark']
      const source = path.resolve(__dirname, 'public/assets/achievements/song/shared/mist')
      const destination = path.resolve(__dirname, '.song-preview-build/assets/achievements/song/shared/mist')
      mkdirSync(destination, { recursive: true })
      for (const name of assets) {
        copyFileSync(path.resolve(source, name + '.webp'), path.resolve(destination, name + '.webp'))
      }
    },
  }],
  build: {
    outDir: path.resolve(__dirname, '.song-preview-build'),
    emptyOutDir: true,
    assetsInlineLimit: 12 * 1024,
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
