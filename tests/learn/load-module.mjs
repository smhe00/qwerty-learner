import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

// Run actual TS modules with explicit boundary ports replaced. One cache per
// loader preserves production singleton identity across multiple consumers.
export function createModuleLoader(dependencies = {}) {
  const cache = new Map()
  const nativeRequire = createRequire(import.meta.url)
  function load(file) {
    const path = resolve(file)
    if (cache.has(path)) return cache.get(path).exports
    const source = readFileSync(path, 'utf8')
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    const module = { exports: {} }
    cache.set(path, module)
    const require = (name) => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      if (name.startsWith('@/')) return load(resolve('src', name.slice(2)) + '.ts')
      if (name.startsWith('.')) return load(resolve(dirname(path), name) + '.ts')
      return nativeRequire(name)
    }
    new Function('module', 'exports', 'require', output)(module, module.exports, require)
    return module.exports
  }
  return load
}
