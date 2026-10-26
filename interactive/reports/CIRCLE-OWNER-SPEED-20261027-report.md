# Circle owner display and latency
Status: IN_PROGRESS; application ready, real before/after etest comparison pending.
Base 3bb25b2ba77adb087332b2c56bd19226e0a75934; claim 460388c6. Workspace C:/Users/peter/Documents/Codex/2026-10-27/qwerty-circle-speed.

## Changes
Owner directly sees 当前口令 and can copy it without opening invitation disclosure. Current custom text is retained in private metadata on create/save and returned only to the authenticated owner, after final membership/session/closure validation. Members never receive server-stored text. Old hash-only records use valid local hints; absent hints cannot be reconstructed and require explicit owner resave/reset. Text/hash mismatch fails closed. This requested display behavior supersedes hash-only storage for new/saved records.

Independent metadata/membership/closure reads, daily list/summary reads, and roster/aggregate reads execute in parallel. Final context supplies current metadata and confirms session/member/closure; redundant immediate extra auth after that same context removed. No cross-request auth cache. Strong writes/readback unchanged. Historical-day response now also includes metadata and roster, removing the UI's redundant today request. Likes/check-ins no longer refresh personal-circle listing. Refresh keeps existing detail visible with controls disabled, clears detail on failure, and preserves an open owner-management panel.

## Local validation
- Seven-day + native HTTP receiver tests: 27/27 PASS. Includes owner-only text, old hashed records, text integrity, concurrent read ordering, session revocation/member removal/closure during aggregate reads.
- Browser suite: 10 of 11 initially passed; management test assumed refresh closed its panel. Updated it to assert the new preserved-open behavior. Focused recheck with normal entry warmup: 2/2 PASS, covering the remaining test. All 11 scenarios therefore covered; no assertion disabled. An isolated cold Vite run exceeded its existing 5s heading wait; normal suite ordering passed unchanged.
- Scoped backend/frontend/test lint PASS. Full TypeScript has existing repository baseline diagnostics; no src/circle or src/pages/Circle diagnostics.
- Build PASS, 38.05s, existing chunk/Browserslist warnings.
- Evidence logs kept outside tracked source; CI will also run Circle UI and Cloud gates.

## Measurement and remaining scope
Real old etest 951f88ba: same synthetic Circle detail GET samples [7587,7872,7515] ms; median 7587 ms. Test process retains credentials only in memory while waiting for the exact new source marker, then verifies legacy local hint, explicit owner save, no-hint owner retrieval, member privacy and same-circle after samples. Samples are descriptive, not a production latency SLA.
No changes to master, KV, concurrency admission, seven-day retention or learning/sync state. Account deletion hold remains; synthetic Circle closes at test completion. Full-product qualification and physical phones remain outside this task.
