# P0 — EdgeOne Blob `onlyIfNew` live-contract mismatch (2026-10-12)

> Status: **BLOCKED — DO NOT RELEASE CIRCLE**.
>
> Scope: confirmed **external API-token SDK path** using `@edgeone/pages-blob@0.0.18`. The deployed Makers Cloud Functions path has **not** been tested by this incident and must be verified independently.
>
> Isolation: `qwerty-circle-sandbox` is an independent Blob namespace within existing Makers project `makers-yggquqwubqul`; it is **not** a separate Makers project. No request targeted `qwerty-data`, no frontend change or Maker deployment was performed.

## Evidence — real SDK, not mocks

- Official Makers SDK read-only discovery resolved project `qwerty-plus` ID `makers-yggquqwubqul` and domain `qwerty-plus.edgeone.dev`: [CI](https://github.com/smhe00/qwerty-learner/actions/runs/38259071467).
- GitHub Actions secret `EDGEONE_API_TOKEN` exists, successfully authenticated read-only `listStores`: [CI](https://github.com/smhe00/qwerty-learner/actions/runs/38259273138). Secret value was never displayed, copied or committed.
- Concurrent conditional-write run `store.setJSON(key, candidate, { onlyIfNew: true })` with two SDK Store clients, 48 writers against one key: **48 fulfilled** instead of exactly one. [CI](https://github.com/smhe00/qwerty-learner/actions/runs/38259590070). The script uses randomized test keys, finally-delete, and no production-user namespace.
- Independent **sequential** diagnostic: first conditional `setJSON` succeeded; second conditional `setJSON` on **the same key** also succeeded and overwrote the first; final read returned the second candidate; delete succeeded and strong read returned `null`. [CI](https://github.com/smhe00/qwerty-learner/actions/runs/38259887502).
- A follow-up [`set()` versus `setJSON()` diagnostic](https://github.com/smhe00/qwerty-learner/actions/runs/38260377530) confirmed the **same failure with both APIs** in external Token mode: first and second writes succeeded; second overwrote first; each randomized test key was subsequently deleted and verified absent. A simple switch to `store.set()` is not a valid workaround.

These results demonstrate that the external SDK mode **did not enforce** the documented `onlyIfNew` contract for the tested requests. They do not establish whether the SDK discards the option, whether the remote Blob service ignores it in token mode, or whether the embedded Makers Functions mode behaves similarly. Do not misattribute root cause before inspecting implementation/wire behavior.

The Circle mock tests passing is now **insufficient** for admission-capacity or idempotency guarantees. The external-mode real Blob Gate has failed.

## Impact and work policy

**Circle:** Do not enable the HTTP API, push to production, merge into product/main, or rely on fixed-seat/event CAS until there is a proven atomic-create primitive on the actual deployment route.

**Potential impact on V4:** Existing backend `cloud-functions/_shared/storage/edgeone-blob.js` calls `store.setJSON(..., {onlyIfNew:true})` for account identity, auth/session versions, and backup revision writes. This shared primitive is a **high-priority validation concern**, but a token-mode result is not sufficient to claim that Makers Functions production calls are broken. Audit it using a safe non-user namespace, a deliberate test deployment, and explicit release approval; preserve users' data. Do not make speculative modifications to account/V4 production logic.

**Storage options:** If there is no trustworthy create-only operation in the runtime, multiwriter Circle membership and permission transitions require a different serialization/transaction mechanism. Strongly consistent `get` does not replace atomic conditional writes. Fail closed rather than silently falling back to read-then-set.

## Required gates

1. Inspect `@edgeone/pages-blob@0.0.18` package implementation, especially external Token mode, to determine if `onlyIfNew` is forwarded to the server.
2. Compare `store.set()` vs `setJSON()` behavior on a handful of randomized sandbox keys, and record result.
3. Obtain a trustworthy minimal test in Makers Cloud Functions runtime on a **sandbox namespace only**, with no account/user data.
4. Investigate the actual V4 CAS path under an appropriately bounded production-readiness procedure, with existing user data protected.
5. Re-run sequential conflict (second write must fail, content unchanged), 48-way parallel write (one winner), ambiguous-response, and crash/retry tests before Circle releases.
6. Verify no residual probe keys remain within `qwerty-circle-sandbox` and record cleanup.

**Critical:** Tests above never touched `master`, `product/main` or the active UI development.
