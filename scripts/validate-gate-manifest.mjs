import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const manifest = JSON.parse(
  readFileSync(
    resolve(root, 'tests/verification/gate-manifest.json'),
    'utf8',
  ),
)

const errors = []
const gateIds = new Set()
const contractIds = new Set()

const specificationPath = manifest.specification
  ? resolve(root, manifest.specification)
  : undefined
const specificationSource =
  specificationPath && existsSync(specificationPath)
    ? readFileSync(specificationPath, 'utf8')
    : ''

if (!specificationPath || !existsSync(specificationPath)) {
  errors.push(
    `missing canonical specification: ${manifest.specification ?? '<missing>'}`,
  )
}

for (const gate of manifest.gates ?? []) {
  if (!gate.id || gateIds.has(gate.id)) {
    errors.push(`duplicate or missing gate id: ${gate.id ?? '<missing>'}`)
  }
  gateIds.add(gate.id)
  if (!gate.workflow || !existsSync(resolve(root, gate.workflow))) {
    errors.push(`missing workflow for gate ${gate.id}: ${gate.workflow}`)
  }
}

for (const contract of manifest.contracts ?? []) {
  if (!contract.id || contractIds.has(contract.id)) {
    errors.push(
      `duplicate or missing contract id: ${contract.id ?? '<missing>'}`,
    )
  }
  contractIds.add(contract.id)

  if (!manifest.levels?.[contract.level]) {
    errors.push(`unknown level for ${contract.id}: ${contract.level}`)
  }
  if (!gateIds.has(contract.gate)) {
    errors.push(`unknown gate for ${contract.id}: ${contract.gate}`)
  }
  if (!contract.owner || !existsSync(resolve(root, contract.owner))) {
    errors.push(`missing owner for ${contract.id}: ${contract.owner}`)
  }

  if (!Array.isArray(contract.specs) || contract.specs.length === 0) {
    errors.push(`no product spec mapping for ${contract.id}`)
  } else {
    for (const specId of contract.specs) {
      if (!specificationSource.includes(specId)) {
        errors.push(
          `contract ${contract.id} references missing spec id: ${specId}`,
        )
      }
    }
  }

  if (!Array.isArray(contract.tests) || contract.tests.length === 0) {
    errors.push(`no tests for ${contract.id}`)
  } else {
    for (const testPath of contract.tests) {
      if (!existsSync(resolve(root, testPath))) {
        errors.push(`missing test for ${contract.id}: ${testPath}`)
      }
    }
  }
}

const regressionCatalogPath = resolve(
  root,
  'tests/verification/regression-catalog.json',
)
if (!existsSync(regressionCatalogPath)) {
  errors.push('missing regression catalog')
} else {
  const catalog = JSON.parse(
    readFileSync(regressionCatalogPath, 'utf8'),
  )
  const regressionIds = new Set()

  for (const regression of catalog.regressions ?? []) {
    if (!regression.id || regressionIds.has(regression.id)) {
      errors.push(
        `duplicate or missing regression id: ${regression.id ?? '<missing>'}`,
      )
      continue
    }
    regressionIds.add(regression.id)

    if (!Array.isArray(regression.tests) || regression.tests.length === 0) {
      errors.push(`regression ${regression.id} has no tests`)
      continue
    }

    for (const ref of regression.tests) {
      if (!ref?.file || !existsSync(resolve(root, ref.file))) {
        errors.push(
          `regression ${regression.id} references missing test file: ${ref?.file}`,
        )
        continue
      }
      if (!ref?.title) {
        errors.push(
          `regression ${regression.id} has a test reference without title`,
        )
        continue
      }

      const source = readFileSync(resolve(root, ref.file), 'utf8')
      if (!source.includes(ref.title)) {
        errors.push(
          `regression ${regression.id} test title not found in ${ref.file}: ${ref.title}`,
        )
      }
    }
  }
}

if (errors.length > 0) {
  throw new Error(
    ['Gate manifest validation failed:', ...errors.map((x) => `- ${x}`)].join(
      '\n',
    ),
  )
}

console.log(
  `Gate manifest OK: ${gateIds.size} gates, ${contractIds.size} contracts, specification and regression catalog validated.`,
)
