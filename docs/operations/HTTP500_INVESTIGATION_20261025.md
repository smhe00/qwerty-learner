# Repeated HTTP500 investigation — 2026-10-25

## Confirmed finding

Diagnostic staging commit24912ac9 produced a real POST `/api/auth/login` HTTP500
at the **request-body** stage. Run40147850618/job121032940738 logged platform
request ID8672541933357853724 at2026-10-25T00:48:57Z. That stage executes before
password verification, session issuance or account business writes. Its reader
still used the Maker `request.text()` compatibility method. The failure is not
an incorrect-password result or an idle-account deletion operation.

[Redacted evidence](../../interactive/reports/HTTP500-REQUEST-BODY-20261025-proof.json).

Historical repository reports already recorded body-reader failures before Blob
writes, including legacy V4. This links one live auth500 to the same component
class; it does NOT establish a vendor-internal defect or prove every earlier
registration/login/delete500 had that cause. Earlier failures without stage
metadata remain unclassified.

## Investigation method

- Cataloged earlier Cloud/History/three-device/cleanup failures, including
  failures predating idle cleanup. Retained unsuccessful/unknown test-account
  cleanup rather than claiming complete erasure.
- Ran isolated urllib and environment-proxied Node-fetch probes:14/14 requests
  succeeded (register, two logins, two reads, cleanup login, delete per client).
  Both disposable accounts were verified deleted and generated credential files
  removed. This demonstrates intermittency, not absence of a bug.
- Added per-request, error-specific phase metadata and validated platform request
  ID, then deployed diagnostics to staging without changing the body reader.
  Preserve HTTP status, errors, sync return types and every E2E assertion. Do
  not record error messages/stacks, provider object paths, bodies or credentials.
- Captured the real failure above with the new diagnostic code. Other completed
  staging scenarios demonstrate that the failure is not universally reproducible.

## Remediation and safety contract

Ordinary JSON requests now use native `arrayBuffer()` plus strict UTF8/JSON and
size/declaration validation, consistent with existing native byte paths, instead
of `request.text()`. Malformed JSON/UTF8 remains400 and excess size413. A native
receiver failure returns a distinct503 `request_body_unavailable` with fixed
`stage=request-body` and `safeToRetry=true`. This code can only originate before
the route starts the account operation; limiter/activity metadata is not an
account registration/password-change/deletion side effect.

A small shared browser/independent-client policy permits **one** fresh transport
retry only for that exact503 proof on register/login/change-password/account
DELETE. It never replays generic500, unknown503, malformed proof, timeout, lost
response, snapshots, merges or unknown commits. The second result is final.
Diagnostic metadata remains for any residual failure at another stage.

This is not a cosmetic500-to503 relabel: the receiver changes, the rejection
has a tested pre-business invariant, and the client recovers only after that
invariant is explicitly confirmed. Platform-native receiver failures may still
happen; their safe recovery is different from blindly replaying an uncertain
write. Existing generic read/login retries in older test tools were not expanded
or used as evidence that a failure disappeared.

## Local qualification

-80/80 focused backend/storage/route/diagnostic/transport contracts PASS.
- Native text-helper failure is bypassed by the byte receiver; failed byte
  reception performs no account operation and never exposes exception contents.
- One rejected body then one fresh request executes register once. The real
  bundled gateway also proves a rejected DELETE leaves its original account
  intact and a proved-safe fresh retry deletes it once.
- Unknown failures/timeouts are never replayed; invalid UTF8/JSON, declared
  oversize and length mismatch remain rejected before business execution.
- Real Chromium2/2: identical-content retry on explicit proof, no retry on a
  generic500, unchanged local learning rows, active owner and saved credentials.
- Production Vite build PASS, scoped lint zero errors, all staging configs parse.
  Full TypeScript retains the identical147 baseline diagnostics, no additions.

## Live verification and remaining limits

The remedy still requires its own exact-SHA staging/browser/Blob/history checks
before any production release. A successful retry or one green run cannot erase
older failures or demonstrate continuous six-month retention reliability. No
customer data, production account, server clock or real SMHE enrollment was used
for diagnosis. Additional storage/vendor failures, if observed, must be assigned
their own stages; this finding is not a blanket explanation for all HTTP500s.
