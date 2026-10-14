# Circle v2 — live EdgeOne Blob event-log contract (2026-10-14)

Status: **PASS for bounded isolated external API-token SDK smoke; NOT a production release authorization**.

## Execution and isolation

- Branch: `feature/circle-core-blob`.
- GitHub Actions run: https://github.com/smhe00/qwerty-learner/actions/runs/38519492124
- Workflow: `.github/workflows/circle-eventual-blob-sandbox.yml`.
- Probe: `scripts/circle-eventual-blob-sandbox.mjs`.
- EdgeOne Makers project: `makers-yggquqwubqul`; independent sandbox Store: **`qwerty-circle-sandbox`**.
- Access path: official `@edgeone/pages-blob@0.0.18` API-token SDK, `consistency: 'strong'`. This is NOT the embedded Makers Cloud Functions route.
- Uses fresh random Circle ID and event IDs under `social/v2/circles/<randomCircleId>/events/<randomEventId>.json`.
- API token was supplied by existing GitHub secret; never printed or written to Git.
- No account/learning/V4 records touched; no production `qwerty-data` access; no Maker build; no `product/main` or `master` change.

## Observed JSON result

```json
{
  "check": "circle_eventual_blob_live_v1",
  "storage": "isolated-sandbox",
  "circleIdLength": 24,
  "operations": 13,
  "casUsed": false,
  "concurrency": 12,
  "converged": true,
  "physicalKeysDistinct": true,
  "cleanupConfirmed": true,
  "deploymentTriggered": false,
  "elapsedMs": 9131,
  "lastObservedCount": 13,
  "cleanupFailures": 0
}
```

Sequence: append one CIRCLE_CREATED event, then concurrently append 12 distinct JOIN_REQUESTED events using new random object keys and **no conditional write**; independently list/get, reduce and validate the 13-member view. Bounded retry handles temporary visibility gaps. Finally delete each tracked key and confirm null on a strong read.

**Note:** `elapsedMs` is elapsed time during convergence polling, NOT a measured write latency or evidence of a 9-second replication SLA.

## Additional safety correction, verified by Circle CI

- `createCircleEventLog.scan()` now **throws** if listing exposes an event key but `get` returns null. This can represent a temporarily unreadable revocation; dropping that key and returning a private view would be unsafe.
- Service maps scan exceptions to typed `503 circle_view_uncertain` rather than exposing raw storage errors.
- An independent regression test covers the listed-but-unreadable key; after visibility recovers the view includes the original event.
- CI: https://github.com/smhe00/qwerty-learner/actions/runs/38519544610 — **74/74 Circle tests passed, 0 failed, scoped ESLint passed**.

## What this does NOT prove

1. Cross-region, multi-device or multi-instance visibility bounds, linearizable membership or strong-access revocation.
2. Atomic CAS/conditional create. Prior real SDK tests conclusively showed `onlyIfNew` was ineffective in this Store path. The v2 smoke **does not use CAS**.
3. Completeness of a listing at a fixed instant. A temporarily omitted event may still produce a partial projection; Circle privacy requires an independently reliable trusted-access authority that can fail closed.
4. Gateway authentication, global source-IP limiter, trustworthy revocation receipt lifecycle, deleted-account recovery, physical erasure or minors' data policy.
5. The deployed Makers Cloud Functions adapter path; only the external SDK route is observed.
6. Sustainable performance, cost, pagination/replay budgets or retention with large Circle histories.

## Next gate

Implement and qualify a production-independent trusted access/fence/retirement adapter, explicit account/IP limiter and account-delete orchestration. Keep `http.js` hard closed and no `product/main`/release changes until the isolation, identity and privacy gates are independently signed off.
