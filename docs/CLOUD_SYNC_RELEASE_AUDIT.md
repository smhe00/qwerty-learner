# Qwerty Integrated Product — Release Audit

> **Status: Historical release audit (2026-09-30).** This file records the
> pre-Learn-Alpha integrated Review/Cloud release process. It is retained for
> traceability, not as the current release contract. See
> [ALPHA_RELEASE_BASELINE.md](./ALPHA_RELEASE_BASELINE.md) for Learn Alpha 1.

> Release candidate preparation: 2026-09-30  
> Development branch: `product/main`  
> Production pointer: `feature/edgeone-cloud-sync`  
> Previous production: `e6cd1ca14080a3ebfdbc47fdb2a3fba5633e87f3`

## Current release scope

This release intentionally ships the integrated Review V2 / adaptive-exercise work together with the duplicate-registration account safety hotfix.

### Cloud / account

- cloud snapshot format: `qwerty-backup-v3` (legacy restore: `qwerty-dexie-gzip-v2`);
- snapshot payload is gzip-compressed and Base64 transported; there is **no client-side AES/PBKDF2/E2EE** in the current product;
- HTTPS transport, revision conflict protection and snapshot retention remain;
- account/session authentication remains opaque-token + scrypt password hashing;
- account deletion removes cloud identity/auth/session/revisions while preserving local IndexedDB;
- password policy is 4–128 characters and registration requires entering the password twice;
- duplicate/normalized-duplicate username registration is rejected with `409 username_taken`;
- duplicate registration must not replace identity/userId, auth/session state, or orphan existing revisions;
- EdgeOne Blob account creation now has a strong-read preflight in addition to provider `onlyIfNew`.

### Review / adaptive exercise

- versioned `ExerciseCondition`, `ReviewPolicyDecision`, `ReviewObservation` and `ReviewEvidence` contracts;
- actual exercise conditions and shadow evidence are persisted with WordRecord;
- rebuildable OrthographyProfile;
- targeted-mask policy with independent-record thresholding;
- session-time exercise-plan freeze to avoid async condition races;
- targeted-mask active in Review mode with scaffold withdrawal / stale-shadow guardrails;
- audio-withdrawal probe active with probe-aware evidence;
- adaptive policy arbitration keeps spelling remediation ahead of audio diagnostic probe;
- raw telemetry/history remains the source of truth and derived profiles remain rebuildable.

## Candidate gates before promotion

The final release commit must have both of these candidate gates green on the **same SHA**:

1. Review Gate;
2. Cloud Sync Gate.

After fast-forwarding the production pointer and EdgeOne deployment, production acceptance requires:

1. EdgeOne Live Gate;
2. EdgeOne Browser Sync Gate;
3. EdgeOne Auth Rate Limit Gate.

## Duplicate-registration invariant

The release contract explicitly requires:

```text
register(username, originalPassword)
upload revision N
register(normalized-same-username, otherPassword)
    -> 409 username_taken

original userId unchanged
original revisions unchanged
original password still valid
replacement password invalid
```

Backend contract tests, Blob adapter tests, live EdgeOne integration and browser regression cover this invariant.

## Security / storage note

The cloud snapshot is **not end-to-end encrypted**. It is gzip-compressed application data stored in EdgeOne Blob and protected by HTTPS plus application authentication/authorization. Storage operators or a storage compromise could in principle read the decompressed learning data. This is an accepted current product tradeoff and must not be described as encrypted cloud backup.

## Release rule

Promotion is fast-forward only:

```text
product/main verified RC
    -> feature/edgeone-cloud-sync
    -> EdgeOne automatic deployment
    -> production Live / Browser / Rate acceptance gates
```

Do not place independent commits on the production pointer.


## Production verification sequencing

The production browser gate waits for the release-specific `duplicate-register-protection-v1` health capability before exercising the duplicate-registration UI. The live integration expectation accounts for the additional successful login used to prove the original account remains valid after a rejected duplicate registration.


### Final Gate load correction

The live integration keeps its own register/login traffic below the production `10/60s` authentication threshold. Session-retention coverage is preserved with two extra logins; the dedicated Auth Rate Limit Gate remains responsible for intentionally crossing the threshold. The rate-limit gate waits for `duplicate-register-protection-v1`, tying the final rate-limit acceptance to this release deployment.


## Final RC trigger set

The final RC deliberately includes the three production acceptance probes (live integration, browser sync, auth rate-limit) as changed test paths so the production-pointer fast-forward triggers all three Gates on the exact same SHA. No product runtime behavior is changed by this RC marker.


## First-review seeding hotfix RC

The integrated release now includes `REVIEW-HOTFIX-001`:

- ordinary learning records (`chapter >= 0`) are learning evidence only;
- ordinary learning failures seed an immediately-due first Review with `reviewCount=0`;
- only Review-mode records (`chapter == -1`) advance the long-term spaced scheduler;
- `CURRENT_REVIEW_STATE_VERSION=4` forces previously mis-scheduled v3 states to rebuild;
- the final RC touches all three production acceptance probes so Live / Browser / Auth Rate Limit run on this exact promoted SHA.


## REVIEW-HOTFIX-002 production RC

Production testing exposed a multi-word Review lifecycle issue: the first word completed, while a later word could reach its last correct letter without advancing.

The fix is deliberately Review-only:
- each Review queue index receives a fresh WordComponent instance;
- per-attempt completion effects, telemetry collectors and exercise-condition refs are reset at a component boundary;
- ordinary learning keeps its upstream component-key semantics unchanged.

Implementation `99601a7d97d2dcc78fdb0cd46f6e1320f6d86944` passed Review Gate #25.


## Review Formal Gate V1 integrated RC — 2026-09-30

This release candidate includes the Review progression architecture hardening:

- terminal input lock and out-of-range typo filtering;
- corrected assisted retrieval semantics;
- one automatic pronunciation per attempt;
- pure Review transition core in `src/review/machine.ts`;
- atomic ReviewRecord projection outside the Typing reducer;
- derived scheduler persistence removed from the UI progression critical path;
- bounded exhaustive model checking;
- real Chrome multi-word Review progression gate.

Verified checkpoint before RC marker:

```text
5a25cce26993e47639a6909b85e7e948d393686a
Review Gate #37 PASS
```

The final marker commit must pass Review Gate and Cloud Sync Gate on the same SHA before promotion.


## Review fresh-error reactivation + Force Review RC — 2026-09-30

This release fixes Review admission after new ordinary-learning errors and adds an explicit force-review path.

Verified behavior:

```text
formal Review completed
-> nextReviewAt in future
-> ordinary learning later produces a fresh error
-> Review bootstrap reactivates the word due-now
-> reviewCount / scheduler stage / lastReviewedAt remain unchanged
```

When no error word is currently due, the UI now offers `强制开始复习`.
Force mode bypasses only the time gate; it still uses the current error-word set,
Review ordering, ExercisePlan generation, evidence capture and the verified
progression state machine.

Pre-RC verification at `67385b38487d563c244ee7621c07325072e968a2`:

```text
Domain regression   46 / 46 PASS
Formal properties   11 / 11 PASS
Real Chrome flow     4 / 4  PASS
Production build            PASS
```
