import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const root = process.cwd()
const errors = []

function sourceFiles(dir) {
  const abs = resolve(root, dir)
  if (!existsSync(abs)) return []

  const result = []
  for (const name of readdirSync(abs)) {
    const path = join(abs, name)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      result.push(...sourceFiles(relative(root, path)))
    } else if (['.ts', '.tsx'].includes(extname(path))) {
      result.push(relative(root, path).replaceAll('\\', '/'))
    }
  }
  return result
}

function importsOf(path) {
  const source = readFileSync(resolve(root, path), 'utf8')
  return [...source.matchAll(
    /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  )].map((match) => match[1])
}

function forbid(path, specifier, reason) {
  errors.push(`${path} -> ${specifier}: ${reason}`)
}

const domainFiles = [
  ...sourceFiles('src/learn'),
  ...sourceFiles('src/review'),
]

for (const path of domainFiles) {
  for (const specifier of importsOf(path)) {
    if (
      specifier === 'react' ||
      specifier.startsWith('react/') ||
      specifier === 'jotai' ||
      specifier.startsWith('jotai/')
    ) {
      forbid(path, specifier, 'domain/application policy cannot depend on React/Jotai runtime')
    }

    if (
      specifier.startsWith('@/pages/') ||
      specifier.startsWith('../pages/') ||
      specifier.startsWith('../../pages/')
    ) {
      forbid(path, specifier, 'domain/application policy cannot import page components')
    }

    if (
      (specifier === '@/store' || specifier.startsWith('@/store/'))
    ) {
      forbid(path, specifier, 'store is an adapter; domain policy must not depend on it')
    }
  }
}

const lowLevelFiles = [
  'src/utils/db/core.ts',
  'src/utils/db/record.ts',
  'src/utils/db/word-record-builder.ts',
  'src/utils/db/review-record-writer.ts',
  'src/utils/time.ts',
]

// This adapter still owns React hooks, but must not pull store initialization
// back in through a utility barrel. That closes the former runtime cycle:
// review-record -> utils -> mixpanel -> store -> reviewInfoAtom -> review-record.
const reviewRecordAdapter = 'src/utils/db/review-record.ts'
for (const specifier of importsOf(reviewRecordAdapter)) {
  if (specifier === '@/utils' || specifier === '..' || specifier === '../index' ||
      specifier === '@/store' || specifier.startsWith('@/store/')) {
    forbid(reviewRecordAdapter, specifier, 'persistence adapter must use leaf utilities without store initialization')
  }
}

for (const path of lowLevelFiles) {
  if (!existsSync(resolve(root, path))) {
    errors.push(`missing low-level architecture file: ${path}`)
    continue
  }

  for (const specifier of importsOf(path)) {
    if (
      specifier === 'react' ||
      specifier.startsWith('react/') ||
      specifier === 'jotai' ||
      specifier.startsWith('jotai/') ||
      specifier.startsWith('@/pages/') ||
      specifier === '@/store' ||
      specifier.startsWith('@/store/') ||
      specifier === '@/resources/soundResource' ||
      specifier === '@/utils' ||
      specifier === '../index'
    ) {
      forbid(path, specifier, 'low-level persistence/pure utility layer cannot depend on UI barrels')
    }
  }
}

if (errors.length > 0) {
  throw new Error(
    ['Architecture boundary validation failed:', ...errors.map((x) => `- ${x}`)].join('\n'),
  )
}

console.log(
  `Architecture boundaries OK: ${domainFiles.length} Learn/Review modules + ${lowLevelFiles.length} low-level files + ReviewRecord adapter.`,
)
