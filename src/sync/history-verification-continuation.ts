import type { WitnessedSetReply } from './api'
import type { HistoryCachePort, HistoryCheckpoint } from './history-verification-cache'
import { HistoryDownloadPending, safeWitnessFailure } from './m3-witnessed-receiver'
import type { WitnessedBatchReadback, WitnessedReaderPort } from './m3-witnessed-receiver'
import type { ChainedReceipt } from './multi-device-outbox'
import { sha256Hex } from './sha256-compat'
import { stableWorkspaceJson } from './workspace-v4'

/** Cache is not trusted: server reauthenticates and revalidates its checkpoint
 * on every visit. Receiver checks cached rows against the final server digest. */
export async function createHistoryContinuation(input: {
  accountId: string
  generation: number
  heads: ChainedReceipt[]
  cache: HistoryCachePort
  assertOwner(): Promise<void>
  canContinue(): boolean
  verify(cursor?: string): Promise<WitnessedSetReply>
  read(receipt: ChainedReceipt): Promise<WitnessedBatchReadback>
  progress?(completed: number, total: number): void
}): Promise<WitnessedReaderPort> {
  const ownerScope = await sha256Hex(
    new TextEncoder().encode(stableWorkspaceJson({ accountId: input.accountId, generation: input.generation })),
  )
  const scope = await sha256Hex(
    new TextEncoder().encode(
      stableWorkspaceJson({
        accountId: input.accountId,
        generation: input.generation,
        heads: [...input.heads].sort((a, b) => stableWorkspaceJson(a).localeCompare(stableWorkspaceJson(b))),
      }),
    ),
  )
  await input.assertOwner()
  const saved = await input.cache.read(input.accountId)
  await input.assertOwner()
  let state: HistoryCheckpoint =
    saved?.ownerScope === ownerScope &&
    Array.isArray(saved.heads) &&
    saved.heads.length > 0 &&
    saved.heads.length <= 4 &&
    saved.heads.every((old) =>
      input.heads.some(
        (current) =>
          current.deviceId === old.deviceId &&
          (current.sequence > old.sequence || stableWorkspaceJson(current) === stableWorkspaceJson(old)),
      ),
    ) &&
    saved.batches &&
    typeof saved.batches === 'object' &&
    !Array.isArray(saved.batches) &&
    Object.keys(saved.batches).length <= 512
      ? { ...saved, scope, heads: input.heads, total: input.heads.reduce((n, h) => n + h.sequence, 0) }
      : { scope, ownerScope, heads: input.heads, verified: 0, total: input.heads.reduce((n, h) => n + h.sequence, 0), batches: {} }
  let downloads = 0
  const persist = async () => {
    await input.assertOwner()
    await input.cache.save(input.accountId, state)
    await input.assertOwner()
  }
  const progress = (done: number, total: number) => {
    try {
      input.progress?.(done, total)
    } catch {
      /* observer only */
    }
  }
  const normalizeError = (error: unknown): Error => {
    const e = error as { code?: string; statusCode?: number; status?: number; name?: string; message?: string }
    const code = e?.code === 'event_chain_not_visible' ? 'gap-or-stale-read' : safeWitnessFailure(e?.code ?? e?.message, '')
    return Error(
      code ||
        (['session_revoked', 'unauthorized'].includes(e?.code ?? '') || (e?.statusCode ?? e?.status) === 401
          ? 'verification-session-revoked'
          : e?.name === 'AbortError' || e?.message === 'startup-sync-budget-exhausted'
          ? 'verification-request-aborted'
          : (e?.statusCode ?? e?.status ?? 0) >= 500
          ? 'verification-server-failed'
          : 'verification-network-failed'),
    )
  }
  return {
    assertOwner: input.assertOwner,
    async verifyHeads() {
      try {
        for (let page = 0; page < 2; page++) {
          await input.assertOwner()
          if (!input.canContinue()) break
          const reply = await input.verify(state.cursor)
          await input.assertOwner()
          if (reply.reason === 'verification-in-progress' && !reply.cursor) throw Error('verification-checkpoint-invalid')
          if (reply.verified || reply.reason === 'verification-in-progress') {
            if (reply.cursor) {
              if (
                !/^[a-f0-9]{64}$/.test(reply.cursor) ||
                typeof reply.receiptsRead !== 'number' ||
                typeof reply.totalReceipts !== 'number' ||
                !Number.isSafeInteger(reply.receiptsRead) ||
                !Number.isSafeInteger(reply.totalReceipts) ||
                reply.receiptsRead < 0 ||
                reply.totalReceipts > 512 ||
                reply.totalReceipts < reply.receiptsRead ||
                reply.publishReady !== false ||
                reply.convergenceComplete !== false ||
                reply.listingIsAuthoritative !== false
              )
                throw Error('verification-checkpoint-invalid')
              state = { ...state, cursor: reply.cursor, verified: reply.receiptsRead, total: reply.totalReceipts }
              await persist()
              progress(state.verified, state.total)
            }
            if (reply.verified) return reply
          } else {
            if (['verification-checkpoint-missing', 'verification-checkpoint-invalid'].includes(reply.reason ?? '')) {
              state = { scope, ownerScope, heads: input.heads, verified: 0, total: state.total, batches: {} }
              await persist() // Reset disposable evidence only; next explicit visit starts fresh.
            }
            return reply
          }
        }
        return {
          verified: false,
          reason: 'verification-in-progress',
          receiptsRead: state.verified,
          totalReceipts: state.total,
          publishReady: false,
          convergenceComplete: false,
          listingIsAuthoritative: false,
        }
      } catch (error) {
        throw normalizeError(error)
      }
    },
    async read(receipt) {
      await input.assertOwner()
      const key = stableWorkspaceJson(receipt)
      if (Object.prototype.hasOwnProperty.call(state.batches, key)) return state.batches[key]
      if (downloads >= 16 || !input.canContinue()) throw new HistoryDownloadPending(Object.keys(state.batches).length, state.total)
      let reply: WitnessedBatchReadback
      try {
        reply = await input.read(receipt)
      } catch (error) {
        throw normalizeError(error)
      }
      await input.assertOwner()
      downloads++
      state.batches[key] = reply
      await persist()
      return reply
    },
  }
}
