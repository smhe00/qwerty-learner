# Circle owner display and latency
Status: REVIEW; application and real etest comparison complete.
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

## Exact-SHA etest acceptance
Application **7f5dd39045bde7229fd0bcb78e38941e68f5784a**, fast-forwarded from etest 951f88ba after development push. Source marker confirmed before post-change operations.
Same circle, owner, session and client; three sequential GET samples per version:
- Before: [7587, 7872, 7515] ms; median 7587 ms.
- After: [3519, 3606, 3706] ms; median 3606 ms (52.5% lower). Provider/network conditions are uncontrolled; this is a measured sample, not a guaranteed response time. Initial list retrieval and mutations still incur additional I/O.
- Old hash-only circle continued displaying its valid local phrase.
- Owner UI saved a phrase (202, 4579 ms); after deleting only synthetic Circle UI hints and reloading, 当前口令 remained visible from the authenticated server response.
- Member GET 200 with no ownerInviteCode. Existing membership preserved; leave 202; old phrase rejected 404; new phrase rejoin 202.
- Closed synthetic circle 889cb1e21ca54475892fe7a3 (202). Synthetic account IDs ba7e88e0f0b8d48bf0ca3a14c06b462d and af486b018486ecdb2c973c800b59776d retain the existing deletion hold. No credentials persisted or user account/data touched.
- Visual inspection confirms owner current phrase visible above invitation disclosure in the PC overlay.
- Live log/script: C:/Users/peter/Documents/Codex/2026-10-27/circle-speed-live.log and live-circle-speed.cjs. Local test/build logs: circle-speed-evidence/ beside the worktree. Screenshot: C:/Users/peter/Documents/Codex/2026-10-26/circle-ui-preview/speed-live-owner.png.

Exact application CI PASS:
- Full Circle UI, scoped TS/lint/build and Pages no-cloud boundary: https://github.com/smhe00/qwerty-learner/actions/runs/40399424241
- Circle Core Gate: https://github.com/smhe00/qwerty-learner/actions/runs/40399424427
- Cloud Sync Gate: https://github.com/smhe00/qwerty-learner/actions/runs/40399424130

Ready for review at https://t.smhe.cn/. Etest remains on the application SHA; the completion report advances development only. Master is unchanged at 15fffa2c762037d8b29d1e5b953c729001ad5f0e. No full-product release qualification or physical-phone claim.
