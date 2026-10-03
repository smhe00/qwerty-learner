import fs from 'node:fs'
import path from 'node:path'

const expected = process.argv[2]
if (!expected) throw new Error('expected version argument is required')

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve('node_modules/ts-fsrs/package.json'), 'utf8'),
)

if (packageJson.version !== expected) {
  throw new Error(
    `Expected ts-fsrs ${expected}, installed ${packageJson.version}`,
  )
}

console.log(
  JSON.stringify(
    {
      ok: true,
      version: packageJson.version,
      engines: packageJson.engines || {},
      type: packageJson.type,
      exports: Boolean(packageJson.exports),
    },
    null,
    2,
  ),
)
