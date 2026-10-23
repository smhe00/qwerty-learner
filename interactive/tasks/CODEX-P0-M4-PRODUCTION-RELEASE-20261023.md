# Authorized M4 production release — 2026-10-23

Status: IN_PROGRESS. Single executor: Codex.
Execution base: `01ed8574da7a231482bf6911038a1fe04e277392`.
Prior report: `interactive/reports/CODEX-P0-M4-SEAL-THREE-DEVICE-20261023-report.md`.

## Authorization and objective

After the complete real etest acceptance, the owner instructed: “如果需要发布，你来推进”.
This authorizes the necessary production release and its disposable-account acceptance.
It supersedes the prior task's no-master instruction for this release; no safety check
or unsupported-state restriction is waived. Do not ask for the same authorization again.

Simply promoting the accepted seal-fix SHA would leave browser publication/adoption
restricted to t.smhe.cn. Connect the same verified flow to exact HTTPS production
origins q.smhe.cn and qwerty-plus.edgeone.dev through one shared rollout policy.
Pages, cloud-disabled builds, localhost, previews, alternate ports and lookalikes
remain disabled. Backend authorization is still bearer/session/account based.

## Required sequence

1. Keep the minimal seal fix and unchanged M4 journal/candidate/owner checks.
2. Run origin/disabled-build policy tests and complete S1, Cloud, Review, Mobile,
   lint/build and relevant feature gates on the final candidate.
3. Fast-forward product/main, verify actual Pages and Cloud admission. Fast-forward
   edgeone-test only for real Cloud acceptance. Require the exact candidate SHA's
   hard three-browser 3/3 union, real Blob/FSRS/CAS pilot and release-ready PASS.
4. Only after these gates, normal fast-forward master to the IDENTICAL candidate;
   never force or release a report-only or untested SHA.
5. Verify actual q.smhe.cn source, loaded assets and single-session gateway. Run
   the same hard three-profile real Learn acceptance there using only a newly
   created uniquely named disposable account; strict verified cleanup remains required.
6. Record deployed SHA, all evidence, remaining limits and any production failure.
   A failed live acceptance stays RED; never silently weaken or retry unknown writes.

## Scope limits

The accepted M4 path adopts a monotonic verified immutable WordRecord prefix and
replays supported FSRS state while preserving the entire local six-table V4,
settings and sessions. It does not merge arbitrary conflicting sessions/settings,
invent UUIDs for legacy rows or automatically replace the cloud V4 snapshot.
Legacy/unreplayable/conflicting states continue to fail closed with local evidence
preserved. No new merge algorithm, multi-session authentication or Circle rollout.

Report: `interactive/reports/CODEX-P0-M4-PRODUCTION-RELEASE-20261023-report.md`.
