# QWERTY Plus — Beta Readiness Record

Date: 2026-10-13  
Status: **NOT APPROVED for Public Beta** (Private/controlled Beta only with backup and explicit risk disclosure)

## Scope freeze
**In scope:** Typing, Learn, FSRS-6 (r=0.84), Session/Block, local recovery, Cloud Sync V4, dictionary catalog, navigation/UI, achievements.
**Out of scope:** Circle / circle-core. It remains on `feature/circle-core-blob`; it is **not** a Beta dependency and must not be merged as part of this release.

Production endpoint for cloud tests: https://qwerty-plus.edgeone.dev/learn  
Development branch: `product/main`; production release branch: `master`; static Pages `gh-pages`.
At the start of this pass, both master and product/main pointed to `230c463413642a28f2bbd253068091164d304567`. All new commits from this pass modify **only CI workflows and test code**, not runtime `src/` or `cloud-functions/`. Do not advance master merely to rerun tests: each master pointer update may consume an EdgeOne Maker build.

## Directly observed verification
| Gate | Result | Evidence |
|---|---|---|
| Dual-site Explorer (anonymous Pages + EdgeOne) | **PASS**, 12/12 | https://github.com/smhe00/qwerty-learner/actions/runs/38333056955 |
| Published Pages across Chromium, Firefox, WebKit | **PASS**, 10 passed, 2 intentionally skipped Chromium-only CDP checks | https://github.com/smhe00/qwerty-learner/actions/runs/38333417191 |
| Cloud Sync backend gate | **PASS** | https://github.com/smhe00/qwerty-learner/actions/runs/38333041256 |
| V4 production isolated disposable-account safety (first new run) | **FAIL**: unexpected HTTP 500 for V3 refusal expected 409 | https://github.com/smhe00/qwerty-learner/actions/runs/38332833770 |
| V4 production safety (attempt 1) | **PASS**: normal V4, conflict refusal, account isolation, explicit V3 rev8→V4 rev9 (approximately 2.88 MB compressed) | https://github.com/smhe00/qwerty-learner/actions/runs/38333041165/attempts/1 |
| V4 production safety (attempt 2) | **FAIL**: 2.88 MB explicit recovery intermittently returned HTTP 500; read-only metadata was still V3 rev8; account cleaned | https://github.com/smhe00/qwerty-learner/actions/runs/38333041165/attempts/2 |
| EdgeOne Production Verify management SDK | **FAIL**: Makers project lookup ResourceNotFound for configured project ID | https://github.com/smhe00/qwerty-learner/actions/runs/38331740895 |
| Review Gate on changed UI contract | **PASS** (completed success) | https://github.com/smhe00/qwerty-learner/actions/runs/38333056876 |

GitHub Issues creation is disabled in this repository (HTTP 410), so this file is the persistent blocking-issue register.

## Open Beta release blockers

### P1 — Intermittent V4 HTTP 500 on already deployed Maker
- First live run: ordinary V4 PUT over an existing V3 revision unexpectedly returned HTTP 500 (expected `409 sync_migration_required`).
- Next attempt: same guard returned correct 409; cloud metadata remained V3 rev1, test passed; the approximately 2.88 MB explicit V3→V4 recovery succeeded.
- Third attempt: same guard returned 409; the large explicit recovery returned `500 internal_error`. **Read-only check showed V3 revision 8 remained unchanged**. No overwrite was observed in that incident.
- All disposable accounts were cleaned after every run; no personal users were used.
- Root cause is **not yet proven**. Candidates to investigate are Blob read/write/list errors, large-payload processing, service limits and transient network/runtime faults. Do not assign causality without backend evidence.
- Required: sanitized backend error classification, bounded reproducibility, and demonstrated safe client reconciliation on unknown outcomes. Do NOT blindly replay a write after a 500: read remote revision, format, SHA and fingerprint first.
- Existing V2 manual client does not advance its local sync baseline without validated uploaded metadata (see `src/sync/v2-manual-executor.ts`); this reduces silent-success risk but does not solve availability.

### P1 Infra — Production deployment identity cannot be verified
- `EdgeOne Production Verify` calls Makers SDK with `makers-cgemngjuuwle` and fails project lookup (`ResourceNotFound`). Public `/api/health` and production V4 calls worked, so this is **not evidence of site downtime**.
- Fix valid project ID/token permission and verify which master commit is actually published. No guessed IDs, no token in source, and do not replace deployment identity proof with a superficial health-only green check.

### P1 Release evidence — Latest candidate gate and sustained testing
- Finish latest Review Gate, with no unexplained red CI, then freeze exactly one release commit.
- Exercise controlled multi-device V4 UI/user journeys; old `production-multi-client.spec.ts` still references obsolete V3 upload/download controls and must not be treated as a passing V4 end-to-end gate.
- Obtain at least five consenting testers for seven days or an equivalent documented controlled acceptance, with no P0 and no open P1 affecting the core learning path.
- Do not claim Public Beta readiness solely because a static Pages deployment succeeds.

## Guardrails / next release decision
1. Diagnose the P1 intermittent production 500 and retain strict expected status semantics. The V4 safety test is intentionally red if response semantics are wrong, even if read-only evidence confirms no overwrite.
2. Repair deployment-pointer CI and final UI/Review gates. Retain reproducible CI logs and exact SHA.
3. Keep Circle isolated and the product UI frozen except for verified P0/P1 defects.
4. **Only after gates are green**, fast-forward master once and verify EdgeOne live runtime and account-isolated V4 flow. Record rollback pointer and release candidate tag. Until then, master remains the tested production baseline, not a new Beta release.

## Scope change: V3 end-of-support (2026-10-13)
- Product decision: **no V3 backup import, cloud migration, V3 UI, or V3→V4 acceptance gate** for Beta.
- Legacy V3 cloud bytes are not deleted or silently overwritten; they are unsupported and must fail closed.
- V4-only live gate now creates exclusively V4 test accounts and validates multiple multi-MB writes and remote hashes.
- Separate V4-only concurrency/stale-revision and catastrophic restore checks remain release-critical.
- Native V4 working workspace capture and restore no longer require an intermediate V3 envelope.

## Follow-up: V4-only Beta scope, native large-backup finding

### Confirmed production Beta P1 (not a V3 compatibility problem)
- On the **already-deployed** `master` EdgeOne backend, V4-only synthetic test accounts succeed with ~263,861-byte and ~527,100-byte compressed revisions and fail at ~1,053,601 bytes with HTTP 500 `internal_error`. Read-only recheck showed V4 remote revision unchanged; cleanup succeeded. Evidence: https://github.com/smhe00/qwerty-learner/actions/runs/38336247928
- Two earlier attempts at ~2.78 MB V4-only compressed backup also failed with HTTP 500 and no observed revision advancement: https://github.com/smhe00/qwerty-learner/actions/runs/38335874983 and https://github.com/smhe00/qwerty-learner/actions/runs/38335987498.
- This is a **separate V4 production capacity/reliability blocker**. Retiring V3 migration does NOT clear it. Exact platform-level limiting layer is unproven.

### Candidate mitigation (unpublished)
- `product/main` now stages large immutable Base64 payload chunks under a separate Blob prefix and commits a compact revision manifest only after all parts complete. Reads verify exact compressed SHA-256 and length before returning the established V4 API snapshot. Metadata/CAS preflight reads only the manifest. Existing inline V4 revisions remain readable.
- This is **not production-verified** and does not constitute proof that an incoming large HTTP request can always reach the function; a request-size or runtime limit could require V4 client/server chunk transport in addition to Blob object chunking.
- Local Cloud Sync Gate has passed after the change: https://github.com/smhe00/qwerty-learner/actions/runs/38336816669.
- V4-only S1 workspace recovery / manual import / multi-device browser gates remain release-blocking until a clean pass with no skipped applicable cases. No release from this candidate.

### Unchanged blockers
- EdgeOne Maker deployment-pointer verification uses an unverified obsolete project ID; fix the project/token linkage without guessing.
- Keep `master` unchanged until all relevant V4-only staging gates pass. Circle remains isolated; no V3 migrations or V3 backup UI are in Beta scope.
