# Qwerty Integrated Product — Release Audit

> Release candidate preparation: 2026-09-30  
> Development branch: `product/main`  
> Production pointer: `feature/edgeone-cloud-sync`  
> Previous production: `e6cd1ca14080a3ebfdbc47fdb2a3fba5633e87f3`

## Current release scope

This release intentionally ships the integrated Review V2 / adaptive-exercise work together with the duplicate-registration account safety hotfix.

### Cloud / account

- cloud snapshot format: `qwerty-dexie-gzip-v2`;
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
