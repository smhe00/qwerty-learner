/**
 * M3 read-only eventually-consistent chained receipt DISCOVERY.
 * The server's Blob listing is a HINT, never complete discovery or merge
 * authority. Reject visible forks, missing prefixes, truncation, invalid
 * selectors, and more devices than the bounded witness verifier supports.
 */
import type { ChainedReceipt } from './multi-device-outbox'
export type ObservedChainedReceiptSet = {
  observed: ChainedReceipt[]
  observedCount: number
  visibleForks: string[]
  visibleGaps: string[]
  truncated: boolean
  listingIsAuthoritative: false
  convergenceComplete: false
}
export type ObservedHeadSelection =
  | { status: 'blocked'; reason: string;
      publishReady: false; convergenceComplete: false }
  | { status: 'heads-observed-only'; heads: ChainedReceipt[];
      publishReady: false; convergenceComplete: false;
      listingIsAuthoritative: false }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DEVICE = /^qwerty-web-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA = /^[a-f0-9]{64}$/
const MAX_DEVICES = 4
const MAX_OBSERVED = 512
export function selectObservedChainedHeads(input: ObservedChainedReceiptSet):
ObservedHeadSelection {
  const blocked = (reason: string): ObservedHeadSelection => ({
    status: 'blocked', reason, publishReady: false, convergenceComplete: false,
  })
  if (!input || !Array.isArray(input.observed) ||
      !Array.isArray(input.visibleForks) ||
      !Array.isArray(input.visibleGaps) ||
      input.listingIsAuthoritative !== false ||
      input.convergenceComplete !== false ||
      input.truncated !== false ||
      !Number.isSafeInteger(input.observedCount) ||
      input.observedCount !== input.observed.length ||
      input.observedCount > MAX_OBSERVED) {
    return blocked('non-authoritative-list-incomplete-or-invalid')
  }
  if (input.visibleForks.length || input.visibleGaps.length) {
    return blocked('visible-fork-or-gap')
  }
  const byDevice = new Map<string, ChainedReceipt[]>()
  for (const head of input.observed) {
    if (!head || typeof head.deviceId !== 'string' ||
        !DEVICE.test(head.deviceId) || !UUID.test(head.batchId) ||
        !SHA.test(head.sha256) ||
        !Number.isSafeInteger(head.sequence) ||
        head.sequence < 1 || head.sequence > 128) {
      return blocked('invalid-receipt-selector')
    }
    const list = byDevice.get(head.deviceId) ?? []
    list.push(head)
    byDevice.set(head.deviceId,list)
  }
  if (byDevice.size > MAX_DEVICES) return blocked('too-many-observed-devices')
  const chosen: ChainedReceipt[] = []
  for (const [deviceId,list] of [...byDevice].sort(([a],[b])=>a.localeCompare(b))) {
    const seen = new Map<number,string>()
    for(const receipt of list) {
      const digest=receipt.batchId+':'+receipt.sha256
      const before=seen.get(receipt.sequence)
      if(before && before!==digest) return blocked('contradictory-device-prefix')
      seen.set(receipt.sequence,digest)
    }
    const maximum=Math.max(...seen.keys())
    for(let number=1;number<=maximum;number++){
      if(!seen.has(number)) return blocked('missing-visible-prefix')
    }
    chosen.push(list.find(receipt=>receipt.sequence===maximum)!)
  }
  if (!chosen.length) return blocked('no-observed-device-heads')
  // Selecting visible prefixes is NOT a claim there are no newer/hidden ones.
  return {status:'heads-observed-only',heads:chosen,
    publishReady:false,convergenceComplete:false,listingIsAuthoritative:false}
}
