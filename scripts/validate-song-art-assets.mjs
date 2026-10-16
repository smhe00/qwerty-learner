#!/usr/bin/env node
/**
 * CI artwork gate for the Song image-first research branch.
 *
 * - Four bitmap fog layers must physically exist and be valid WebP.
 * - Draft porcelain scenes/seals must stay unapproved; a pack cannot be
 *   switched to "approved" while required image files are absent.
 * - Never infer hidden artwork availability from a concept screenshot.
 */
import fs from 'node:fs'
import path from 'node:path'

const cwd = process.cwd()
const base = 'public/assets/achievements/song'
const source = fs.readFileSync('src/achievement/visual-assets/spec.ts', 'utf8')
const requiredFog = ['far-light', 'near-light', 'far-dark', 'near-dark']
const errors = []

for (const name of requiredFog) {
  const rel = base + '/shared/mist/' + name + '.webp'
  const full = path.join(cwd, rel)
  if (!fs.existsSync(full)) {
    errors.push('Missing fog bitmap: ' + rel)
    continue
  }
  const bytes = fs.readFileSync(full)
  if (bytes.length < 500 || bytes.length > 150000 ||
      bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 12) !== 'WEBP' ||
      bytes.readUInt32LE(4) + 8 !== bytes.length) {
    errors.push('Invalid/corrupted or oversize WebP image: ' + rel)
  } else {
    console.log('OK ' + rel + ': ' + bytes.length + ' bytes')
  }
}

const id = 'ACH_MASTERED_100'
const stageMatch = source.match(/^\s+stage:\s*'([^']+)'/m)
if (!stageMatch || !['pending_art_review', 'approved'].includes(stageMatch[1])) {
  errors.push('Unknown art review stage in spec.ts')
}
if (stageMatch?.[1] === 'approved') {
  const expected = [
    'scene-light.webp', 'scene-dark.webp',
    'artifact.webp', 'artifact-dark.webp',
    'seal-red.webp', 'seal-ghost.webp', 'seal-press.webp',
  ]
  for (const filename of expected) {
    const file = path.join(cwd, base, id, filename)
    if (!fs.existsSync(file)) errors.push('Cannot approve ' + id + ': missing ' + filename)
  }
}

const catalog = JSON.parse(fs.readFileSync('src/resources/achievementCulture/achievements.json', 'utf8'))
const first = catalog.find(x => x.id === id)
if (!first || first.rarity !== 'rare' || first.presentation.rollout !== 'p0') {
  errors.push(id + ' missing or changed rarity/rollout: update visual review')
}

if (!fs.existsSync('docs/design/achievement-song-collection/references/target-02-gallery-concept.webp')) {
  errors.push('Approved design reference picture missing from git')
}

if (errors.length) {
  errors.forEach(err => console.error('ERROR ' + err))
  process.exit(1)
}
console.log('Song image pack validation passed (draft artwork remains gated)')
