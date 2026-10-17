#!/usr/bin/env node
/**
 * Verify all ten independent, binary WebP pictures and their ID binding.
 * This gate prevents broken Git binary conversion, ID swaps and accidental
 * changes to established achievement rarity/rollout.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve('public/assets/achievements/song/first-batch')
const manifest = JSON.parse(readFileSync('docs/design/achievement-song-collection/assets/First-Batch-20261017.json', 'utf8'))
const catalog = JSON.parse(readFileSync('src/resources/achievementCulture/achievements.json', 'utf8'))
const code = readFileSync('src/achievement/visual-assets/firstBatch.ts', 'utf8')
const ids = new Set(manifest.entries.map(entry => entry.id))
assert.equal(ids.size, 10)
assert.equal(manifest.entries.length, 10)
assert.deepEqual(readdirSync(root).filter(name => name.endsWith('.webp')).sort(),
  [...ids].map(id => id + '.webp').sort())
for (const entry of manifest.entries) {
  const id = entry.id
  const existing = catalog.find(achievement => achievement.id === id)
  assert.ok(existing && !existing.hidden && existing.enabled, 'Missing or hidden achievement ' + id)
  assert.equal(existing.title, entry.title, id + ' title drift')
  assert.equal(existing.rarity, entry.rarity, id + ' real rarity drift')
  assert.equal(existing.presentation.rollout, entry.rollout, id + ' rollout drift')
  assert.ok(code.includes("'" + id + "'"), id + ' missing in TypeScript whitelist')
  const buf = readFileSync(path.join(root, id + '.webp'))
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF', id)
  assert.equal(buf.toString('ascii', 8, 12), 'WEBP', id)
  assert.equal(buf.readUInt32LE(4) + 8, buf.length, id + ' corrupted binary/WebP RIFF length')
  assert.equal(buf.length, entry.sizeBytes, id + ' unexpected size')
  assert.equal(createHash('sha256').update(buf).digest('hex'), entry.sha256, id + ' SHA-256')
  assert.ok(buf.length < 200 * 1024, id + ' oversized first screen art')
  console.log('PASS ' + id + ' ' + (buf.length / 1024).toFixed(1) + 'KiB rarity=' + entry.rarity + ', rollout=' + entry.rollout)
}
console.log('PASS all 10 static art pictures; 9 P0 displayed by current UI and 1 P1 stored')
