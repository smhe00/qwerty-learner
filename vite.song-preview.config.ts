import react from '@vitejs/plugin-react'
import path from 'node:path'
import { cpSync, mkdirSync } from 'node:fs'
import { defineConfig } from 'vite'

/** Safe read-only Song Achievement demo: separate HTML entry, no S1 boot or Dexie imports. */
export default defineConfig({
  root: path.resolve(__dirname, 'preview/song-achievements'),
  base: '/qwerty-learner/previews/song-achievements/',
  plugins: [react(), {
    name: 'copy-song-fog-bitmaps',
    closeBundle() {
      const source = path.resolve(__dirname, 'public/assets/achievements/song')
      const destination = path.resolve(__dirname, '.song-preview-build/assets/achievements/song')
      mkdirSync(destination, { recursive: true })
      cpSync(source, destination, { recursive: true })
    },
  }],
  build: {
    outDir: path.resolve(__dirname, '.song-preview-build'),
    emptyOutDir: true,
    assetsInlineLimit: 12 * 1024,
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
