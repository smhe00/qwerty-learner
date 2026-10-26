import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'

test('UI cannot construct a receipt or a Learn completion without a service receipt', () => {
  const file = resolve('tests/learn/receipt-contract.virtual.ts')
  const source = `
    import type { DurableWordRecordReceipt } from '../../src/learn/word-record-commit'
    import type { WordFinishResult } from '../../src/learn/word-completion'
    declare const fields: Omit<DurableWordRecordReceipt, symbol>
    // @ts-expect-error: only the service owns the private receipt brand
    const fabricated: DurableWordRecordReceipt = fields
    declare const observation: Omit<Extract<WordFinishResult, { mode: 'learn' }>, 'receipt'>
    // @ts-expect-error: an observation alone cannot complete Learn
    const premature: WordFinishResult = observation
    declare const receipt: DurableWordRecordReceipt
    const valid: WordFinishResult = { ...observation, receipt }
  `
  const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd())
  const host = ts.createCompilerHost(parsed.options)
  const read = host.readFile
  host.readFile = (name) => resolve(name) === file ? source : read(name)
  const program = ts.createProgram([file], parsed.options, host)
  const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.file && resolve(d.file.fileName) === file)
  assert.deepEqual(errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
})
