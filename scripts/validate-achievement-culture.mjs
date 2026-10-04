#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const dataDir = path.join(root, 'src', 'resources', 'achievementCulture')

const read = (name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'))

const themes = read('themes.json')
const metrics = read('metrics.json')
const culture = [
  ...read('culture-classics-1.json'),
  ...read('culture-classics-2.json'),
  ...read('culture-stories.json'),
]
const achievements = read('achievements.json')

const errors = []
const warnings = []

const unique = (items, label) => {
  const seen = new Set()
  for (const item of items) {
    if (!item.id) errors.push(`${label}: missing id`)
    if (seen.has(item.id)) errors.push(`${label}: duplicate id ${item.id}`)
    seen.add(item.id)
  }
  return seen
}

const themeIds = unique(themes, 'theme')
const cultureIds = unique(culture, 'culture')
const metricIds = unique(metrics, 'metric')
unique(achievements, 'achievement')

for (const entry of culture) {
  for (const field of ['id', 'type', 'title', 'text', 'source', 'author', 'era', 'studentMeaning']) {
    if (!entry[field]) errors.push(`culture ${entry.id}: missing ${field}`)
  }

  if (!Array.isArray(entry.themes) || entry.themes.length === 0) {
    errors.push(`culture ${entry.id}: no themes`)
  }

  for (const theme of entry.themes ?? []) {
    if (!themeIds.has(theme)) errors.push(`culture ${entry.id}: unknown theme ${theme}`)
  }

  if (!entry.curriculum?.shanghaiExamClaim) {
    errors.push(`culture ${entry.id}: missing curriculum.shanghaiExamClaim`)
  }

  if (
    entry.curriculum?.shanghaiExamClaim !== 'not_claimed' &&
    entry.curriculum?.shanghaiExamClaim !== 'verified_for_specific_year'
  ) {
    errors.push(`culture ${entry.id}: invalid Shanghai exam claim`)
  }

  if (!entry.artDirection?.motif || !entry.artDirection?.scene) {
    errors.push(`culture ${entry.id}: incomplete artDirection`)
  }
}

const cultureById = new Map(culture.map((entry) => [entry.id, entry]))

for (const achievement of achievements) {
  for (const field of ['id', 'title', 'category', 'rarity']) {
    if (!achievement[field]) errors.push(`achievement ${achievement.id}: missing ${field}`)
  }

  if (!achievement.condition?.metric) {
    errors.push(`achievement ${achievement.id}: missing condition.metric`)
  } else if (!metricIds.has(achievement.condition.metric)) {
    errors.push(`achievement ${achievement.id}: unknown metric ${achievement.condition.metric}`)
  }

  if (!Array.isArray(achievement.themes) || achievement.themes.length === 0) {
    errors.push(`achievement ${achievement.id}: no themes`)
  }

  for (const theme of achievement.themes ?? []) {
    if (!themeIds.has(theme)) errors.push(`achievement ${achievement.id}: unknown theme ${theme}`)
  }

  const refs = [
    achievement.culture?.primaryId,
    ...(achievement.culture?.alternateIds ?? []),
  ]

  for (const ref of refs) {
    if (!cultureIds.has(ref)) {
      errors.push(`achievement ${achievement.id}: missing culture ref ${ref}`)
    }
  }

  const primary = cultureById.get(achievement.culture?.primaryId)
  if (primary && !achievement.themes.some((theme) => primary.themes.includes(theme))) {
    errors.push(
      `achievement ${achievement.id}: primary culture ${primary.id} has no overlapping spirit theme`,
    )
  }

  if (!['common', 'rare', 'epic', 'legendary'].includes(achievement.rarity)) {
    errors.push(`achievement ${achievement.id}: invalid rarity ${achievement.rarity}`)
  }

  if (achievement.hidden && achievement.presentation?.progress !== 'hidden') {
    errors.push(`achievement ${achievement.id}: hidden achievement must hide progress`)
  }

  if (achievement.unlockPolicy !== 'once') {
    errors.push(`achievement ${achievement.id}: collection achievements must unlock once`)
  }

  if (!['p0', 'p1', 'p2'].includes(achievement.presentation?.rollout)) {
    errors.push(`achievement ${achievement.id}: invalid rollout`)
  }

  if (!['quiet', 'settlement', 'spotlight', 'ceremony'].includes(achievement.presentation?.ceremony)) {
    errors.push(`achievement ${achievement.id}: invalid ceremony`)
  }

  if (
    !achievement.artDirection?.symbol ||
    !achievement.artDirection?.illustrationPrompt ||
    !achievement.artDirection?.paletteMood ||
    !achievement.artDirection?.material
  ) {
    errors.push(`achievement ${achievement.id}: incomplete artDirection`)
  }
}

const cultureTexts = new Map()
for (const entry of culture) {
  const key = entry.text.replace(/\s+/g, '')
  if (cultureTexts.has(key)) {
    warnings.push(`duplicate culture text: ${entry.id} / ${cultureTexts.get(key)}`)
  } else {
    cultureTexts.set(key, entry.id)
  }
}

const counts = {
  spiritThemes: themes.length,
  achievementMetrics: metrics.length,
  cultureEntries: culture.length,
  achievements: achievements.length,
  hiddenAchievements: achievements.filter((item) => item.hidden).length,
  highJuniorMiddleRelevance: culture.filter(
    (item) => item.curriculum?.relevance === 'high',
  ).length,
}

console.log('Achievement + Culture Library validation')
console.log(JSON.stringify(counts, null, 2))

if (warnings.length) {
  console.warn(`Warnings (${warnings.length}):`)
  for (const warning of warnings) console.warn(`- ${warning}`)
}

if (errors.length) {
  console.error(`Errors (${errors.length}):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('OK: all IDs, references, theme bindings and required metadata are valid.')
