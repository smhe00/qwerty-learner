import { execFileSync } from 'node:child_process'
import path from 'node:path'
import ts from 'typescript'

const baseline = 'a2dc907c9c0f6e8924f441fa360ebabd317233dd'
const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const changes = git(['diff', '--name-status', baseline, '--', 'src', 'tsconfig.json']).split('\n').filter(Boolean)
const before = new Map(),
  added = new Set()
for (const change of changes) {
  const [status, file] = change.split('\t')
  const absolute = path.resolve(file)
  if (status === 'A') added.add(absolute)
  else before.set(absolute, execFileSync('git', ['show', baseline + ':' + file], { encoding: 'utf8' }))
}
// Newly created, not-yet-staged source must not leak into the baseline program.
for (const file of git(['ls-files', '--others', '--exclude-standard', '--', 'src']).split('\n').filter(Boolean)) {
  added.add(path.resolve(file))
}
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile)
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd())
function diagnostics(useBaseline) {
  const host = ts.createCompilerHost(parsed.options)
  const read = host.readFile.bind(host)
  host.readFile = (file) => {
    const absolute = path.resolve(file)
    if (useBaseline && added.has(absolute)) return undefined
    return useBaseline && before.has(absolute) ? before.get(absolute) : read(file)
  }
  host.getSourceFile = (file, language) => {
    const text = host.readFile(file)
    return text === undefined ? undefined : ts.createSourceFile(file, text, language)
  }
  const files = parsed.fileNames.filter((file) => !useBaseline || !added.has(path.resolve(file)))
  return ts
    .getPreEmitDiagnostics(ts.createProgram(files, parsed.options, host))
    .map(
      (d) =>
        (d.file ? path.relative(process.cwd(), d.file.fileName).replaceAll('\\', '/') : 'config') +
        ':TS' +
        d.code +
        ':' +
        ts.flattenDiagnosticMessageText(d.messageText, ' '),
    )
}
const old = diagnostics(true),
  current = diagnostics(false),
  counts = new Map()
old.forEach((d) => counts.set(d, (counts.get(d) || 0) + 1))
const introduced = current.filter((d) => {
  const n = counts.get(d) || 0
  if (!n) return true
  counts.set(d, n - 1)
  return false
})
console.log(
  JSON.stringify(
    { baseline, baselineDiagnostics: old.length, currentDiagnostics: current.length, introducedDiagnostics: introduced },
    null,
    2,
  ),
)
if (introduced.length) process.exitCode = 1
