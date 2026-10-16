import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

/** Safe read-only Song Achievement demo: separate HTML entry, no S1 boot or Dexie imports. */
export default defineConfig({
  root: path.resolve(__dirname, 'preview/song-achievements'),
  base: '/qwerty-learner/previews/song-achievements/',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '.song-preview-build'),
    emptyOutDir: true,
    assetsInlineLimit: 12 * 1024,
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
