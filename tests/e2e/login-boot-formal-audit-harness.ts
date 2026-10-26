/* Local-only diagnostic harness: real kernels and IndexedDB, synthetic network ports. */
import { tryDeclareCheckoutAfterPublication } from '../../src/sync/m3-checkout-cycle'
import { executeManualSyncV2, payloadV4 } from '../../src/sync/v2-manual-executor'
import { recoverSyncV2Pull } from '../../src/sync/v2-pull-transaction'
import './backup-harness'
import { ungzip } from 'pako'

const check = (value: unknown, message: string) => {
  if (!value) throw Error('audit-invariant:' + message)
}
const clone = <T>(value: T): T => structuredClone(value)
const owner = { kind: 'account' as const, accountId: 'local-formal-fixture' }

async function runAudit() {
  const h = (window as any).__backupHarness
  const fp = h.workspaceFingerprintV4
  await h.seed()
  await h.clearAllTables()
  localStorage.setItem(
    'qwerty.cloudAuth.v1',
    JSON.stringify({
      token: 'local-only-never-transmitted',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { userId: owner.accountId, username: 'local-formal-fixture' },
    }),
  )
  const registry = await h.initializeLegacyWorkspace(owner)
  const lease = await h.acquireWorkspaceWriterLease()
  const capture = () => h.captureWorkingWorkspaceV4(owner)
  const row = (n: number) => ({
    attemptId: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'),
    word: 'synthetic-' + n,
    dict: 'cet4',
    chapter: -1,
    sourceMode: 'learn',
    learnItemKind: 'review',
    timeStamp: 1_800_000_000 + n,
    timing: [100],
    wrongCount: 0,
    mistakes: {},
  })
  async function cloud(snapshot: any, revision: number) {
    const payload = await payloadV4(snapshot)
    return {
      snapshot: clone(snapshot),
      bytes: payload.bytes,
      meta: {
        hasData: true,
        revision,
        updatedAt: null,
        sizeBytes: payload.bytes.length,
        dataSha256: payload.checksum,
        payloadSha256: payload.checksum,
        logicalFingerprint: await fp(snapshot),
        clientFormatVersion: 'qwerty-backup-v4',
        deviceId: null,
        storageEncoding: 'binary',
      },
    }
  }
  const download = (c: any) => ({ ...c.meta, payloadEncoding: 'binary', payloadBytes: c.bytes })
  try {
    await h.db.wordRecords.add(row(1))
    const remote = await capture()
    await h.db.wordRecords.add(row(2))
    const rawLocal = await capture()
    // Canonicalize through the actual six-table merger, avoiding a fake merge oracle.
    const local = await h.mergeAccountV4Snapshots(rawLocal, remote)
    const localFp = await fp(local)
    const remoteFp = await fp(remote)
    const candidate = await h.mergeAccountV4Snapshots(local, remote)
    check((await fp(candidate)) === localFp, 'actual union equals local')
    await h.restoreWorkingWorkspaceV4(remote, owner)
    h.refreshWorkspaceMigrationWitness()
    await h.compareAndSwapSyncV2Baseline(owner.accountId, null, {
      accountId: owner.accountId,
      baseRevision: 1,
      logicalFingerprint: remoteFp,
    })
    const phases: string[] = []
    await h.executeM4Merge(
      h.m4MergeJournalPort,
      {
        capture,
        restore: (s: unknown) => h.restoreWorkingWorkspaceV4(s, owner),
        seal: async () => h.refreshWorkspaceMigrationWitness(),
      },
      { accountId: owner.accountId, registryGeneration: registry.generation, expectedOriginalFingerprint: remoteFp, candidate: local },
      (phase: string) => phases.push(phase),
    )
    const m4 = {
      phases,
      baselineCleared: (await h.loadSyncV2Baseline(owner.accountId)) === null,
      journalCleared: (await h.m4MergeJournalPort.read()) === null,
      fullLocalEqualsCandidate: (await fp(await capture())) === localFp,
    }
    let liveCloud = await cloud(remote, 1)
    const io: string[] = []
    const port: any = {
      accountId: owner.accountId,
      registryGeneration: registry.generation,
      assertQuiescentOwner: async () => {
        const r = await h.workspaceRegistryPort.read()
        check(r.generation === registry.generation && r.active.accountId === owner.accountId && !r.pending, 'owner stable')
      },
      flush: async () => {},
      capture,
      readBaseline: () => h.loadSyncV2Baseline(owner.accountId),
      compareAndSwapBaseline: (a: any, b: any) => h.compareAndSwapSyncV2Baseline(owner.accountId, a, b),
      getMeta: async () => {
        io.push('meta')
        return clone(liveCloud.meta)
      },
      getSnapshot: async () => {
        io.push('download')
        return download(liveCloud)
      },
      put: async (input: any) => {
        io.push('CAS-upload')
        check(input.baseRevision === liveCloud.meta.revision, 'CAS revision')
        liveCloud = await cloud(JSON.parse(ungzip(input.payloadBytes, { to: 'string' })), input.baseRevision + 1)
        return clone(liveCloud.meta)
      },
      saveSource: (s: any) => h.saveWorkspaceToVault(owner, s),
      journal: h.syncV2PullJournalPort,
      automaticMerge: {
        build: h.mergeAccountV4Snapshots,
        archive: (a: any, b: any, c: any) => h.archiveAutomaticV4Merge(owner.accountId, registry.generation, a, b, c),
      },
    }
    const first = await executeManualSyncV2(port)
    const pending = await h.syncV2PullJournalPort.read()
    const sameLocalMerge = {
      candidateEqualsLocal: (await fp(candidate)) === localFp,
      status: first.status,
      stagedSnapshotEqualsLive: !!pending && (await fp(pending.snapshot)) === (await fp(await capture())),
      cloudEqualsLive: liveCloud.meta.logicalFingerprint === (await fp(await capture())),
      baselineStillNullAtStage: (await h.loadSyncV2Baseline(owner.accountId)) === null,
      ioBeforeRecovery: [...io],
      afterRecoveryStatus: '',
      recoveryPhases: [] as string[],
    }
    await recoverSyncV2Pull(
      h.syncV2PullJournalPort,
      {
        restore: (s: any) => h.restoreWorkingWorkspaceV4(s, owner),
        seal: async () => h.refreshWorkspaceMigrationWitness(),
      },
      (p) => sameLocalMerge.recoveryPhases.push(p),
    )
    sameLocalMerge.afterRecoveryStatus = (await executeManualSyncV2(port)).status
    check((await fp(await capture())) === localFp, 'roundtrip local unchanged')

    const faults = []
    for (const fault of [
      'none',
      'metadata-offline',
      'download-timeout',
      'download-corrupt',
      'archive-quota',
      'remote-advanced',
      'precommit-503',
      'commit-ack-lost',
      'commit-invalid-ack',
      'owner-lost-before-write',
      'owner-lost-after-commit',
      'stage-before-commit',
      'stage-after-commit',
    ]) {
      const state: any = {
        local: clone(local),
        baseline: null,
        journal: null,
        cloud: await cloud(remote, 1),
        writes: 0,
        archived: false,
        metaCalls: 0,
        ownerLost: false,
      }
      const p: any = {
        accountId: owner.accountId,
        registryGeneration: registry.generation,
        assertQuiescentOwner: async () => {
          if (state.ownerLost) throw Error('owner-lost')
        },
        flush: async () => {},
        capture: async () => clone(state.local),
        readBaseline: async () => clone(state.baseline),
        compareAndSwapBaseline: async (old: any, next: any) => {
          check(JSON.stringify(old) === JSON.stringify(state.baseline), 'baseline CAS')
          state.baseline = clone(next)
        },
        getMeta: async () => {
          state.metaCalls++
          if (fault === 'metadata-offline') throw Error('network-offline')
          if (fault === 'remote-advanced' && state.metaCalls > 1) return { ...state.cloud.meta, revision: 2 }
          return clone(state.cloud.meta)
        },
        getSnapshot: async () => {
          if (fault === 'download-timeout') throw new DOMException('timeout', 'AbortError')
          if (fault === 'download-corrupt') return { ...download(state.cloud), payloadBytes: new Uint8Array([1, 2]) }
          return download(state.cloud)
        },
        put: async (input: any) => {
          state.writes++
          check(state.archived, 'archive precedes write')
          check(!state.ownerLost, 'no write after owner loss')
          check(input.baseRevision === state.cloud.meta.revision, 'write CAS')
          if (fault === 'precommit-503') throw Error('typed-precommit-503')
          state.cloud = await cloud(JSON.parse(ungzip(input.payloadBytes, { to: 'string' })), input.baseRevision + 1)
          if (fault === 'commit-ack-lost') throw new DOMException('response lost', 'AbortError')
          if (fault === 'owner-lost-after-commit') state.ownerLost = true
          if (fault === 'commit-invalid-ack') return { ...state.cloud.meta, payloadSha256: '0'.repeat(64) }
          return clone(state.cloud.meta)
        },
        saveSource: async () => {
          if (fault === 'owner-lost-before-write') state.ownerLost = true
        },
        journal: {
          read: async () => clone(state.journal),
          stage: async (j: any) => {
            if (fault === 'stage-before-commit') throw Error('idb-abort')
            state.journal = clone(j)
            if (fault === 'stage-after-commit') throw Error('simulated caller interrupted after durable stage')
          },
          finalize: async (j: any) => {
            state.baseline = { accountId: owner.accountId, baseRevision: j.revision, logicalFingerprint: j.fingerprint }
            state.journal = null
          },
        },
        automaticMerge: {
          build: h.mergeAccountV4Snapshots,
          archive: async () => {
            if (fault === 'archive-quota') throw new DOMException('quota', 'QuotaExceededError')
            state.archived = true
          },
        },
      }
      let result = 'threw'
      try {
        result = (await executeManualSyncV2(p)).status
      } catch {
        /* Expected fault, retain all state. */
      }
      check(state.writes <= 1, 'no ambiguous replay')
      check((await fp(state.local)) === localFp, 'execution never overwrites live local')
      check(state.baseline === null, 'no baseline before verified success/recovery')
      if (fault === 'stage-after-commit' || fault === 'none') check(state.journal !== null, 'durable staged target retained')
      const record: any = {
        fault,
        status: result,
        writes: state.writes,
        cloudRevision: state.cloud.meta.revision,
        journalRetained: !!state.journal,
        baselineAdvanced: state.baseline !== null,
        safetyChecksPassed: true,
      }
      if (fault === 'commit-ack-lost' || fault === 'commit-invalid-ack') {
        // Fresh invocation reads exact committed metadata; no POST replay.
        p.getMeta = async () => clone(state.cloud.meta)
        record.nextStatus = (await executeManualSyncV2(p)).status
        check(record.nextStatus === 'noop' && state.writes === 1, 'lost ACK reconciles via metadata')
      }
      faults.push(record)
    }

    const deviceId = 'qwerty-web-00000000-0000-4000-8000-000000000010'
    const head = { deviceId, sequence: 1, batchId: '00000000-0000-4000-8000-000000000011', sha256: 'b'.repeat(64) }
    let releaseDeclaration!: (value: any) => void
    let entered!: () => void
    const enteredDeclaration = new Promise<void>((r) => {
      entered = r
    })
    let settled = false
    const optional = tryDeclareCheckoutAfterPublication({
      accountId: owner.accountId,
      deviceId,
      published: { status: 'uploaded-events-only', scanned: 2, batches: 1, remaining: 0 },
      port: {
        assertOwner: async () => {},
        readOutbox: async () =>
          ({
            version: 1,
            accountId: owner.accountId,
            deviceId,
            pending: [],
            inflight: null,
            confirmedHead: head,
            confirmedEvidence: {},
          } as any),
        declare: () =>
          new Promise((r) => {
            releaseDeclaration = r
            entered()
          }),
      },
    }).then((r) => {
      settled = true
      return r
    })
    await enteredDeclaration
    const optionalCheckout = { publishedButPending: !settled, afterFailure: '' }
    releaseDeclaration({ status: 'blocked', reason: 'injected-network-failure', publishReady: false, convergenceComplete: false })
    optionalCheckout.afterFailure = (await optional).status
    return {
      sourceSha: '1030f9cd809858e7b14ea9132ae3c2508ef51b04',
      scope: 'real Chromium Dexie and actual S2/M4/merge kernels; synthetic network and fault ports; not live release qualification',
      m4,
      sameLocalMerge,
      faults,
      optionalCheckout,
    }
  } finally {
    lease.release()
  }
}
;(window as any).__loginBootAudit = runAudit
