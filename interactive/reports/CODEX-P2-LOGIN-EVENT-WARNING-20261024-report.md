# Login event warning investigation

Status REVIEW for the scoped duplicate-execution/message correction. Base bee3240ffcf1b120fab22bf43347e33698e29cc0.

Confirmed: V4 outcome noop is independent of M3. Login M3 recovers all wordRecords, and invalid legacy identity or immutable conflicts can block even with no new learning. Login currently breaks only its publication loop, calls M4 anyway, and M4 publishes again before any remote receipt observation. One upstream error can thus produce both warnings. Exact trigger for the reported account is not proven; no real records were read or modified.

Plan: return from the event sequence on blocked M3, preserve the V4 result and one honest reason-specific message, retain all guards. Focused synthetic login-handler tests and adjacent contracts only. No deployment.

The owner supplied bounded stage traces confirming outbox-recovery-legacy-or-corrupt-attempt, followed repeatedly by m3-publication:outbox-recovery-legacy-or-corrupt-attempt. This establishes the failing phase and shared cause, not which field or record failed. immutableAttempt requires a version-4 UUID, explicit sourceMode and valid event fields; absence in pre-event records is documented in IWordRecord. The same combined error also covers malformed fields. Do not call the account corrupt or claim legacy compatibility is repaired. Full V4 supports legacy payloads separately; the event projection explicitly rejects unanchored legacy rows too, so merely skipping the recovery guard would not be a correct repair.

RED: actual login UI handler with injected external IO and real recovery/cycle kernels produced M3 -> M4 -> M3 for unchanged legacy rows. Five new assertions failed as expected (three invalid historical rows, contradiction, retained transport); four unaffected paths passed. No user data touched.

## Result and evidence

The login handler now returns immediately after blocked M3 publication. It does not call M4 (which starts M3 again), retry an uncertain publication in the same login, or add the second downstream warning. A fixed allowlist maps recovery-format, conflicting-identity and scan-limit reasons to accurate public descriptions; all other failures retain a generic pending message. The bounded auth trace saves only the fixed category. V4 checking, event admission, durable outbox, ownership and actual M4-rejection behavior remain unchanged.

Source locations in this fix:
- src/sync/workspace-account-ui.ts:27: fixed public descriptions; :188: stop after blocked publication.
- src/sync/multi-device-recovery-browser.ts:39: read all historical word rows, independent of new learning.
- src/sync/multi-device-recovery.ts:29: invalid immutable evidence blocks the whole scan, before publication.
- src/sync/multi-device-outbox.ts:64: UUID, sourceMode, timestamps and other admission predicates share the same error.
- src/sync/m4-witnessed-prefix-browser.ts:112: M4 itself invokes M3 before any remote observation, explaining the duplicate.
- src/sync/m4-witnessed-prefix-candidate.ts:112: unanchored legacy local attempts are separately blocked in M4; skipping the M3 guard alone would not solve compatibility.

GREEN: node --test tests/cloud/login-event-warning.test.mjs tests/cloud/multi-device-recovery.test.mjs tests/cloud/m3-publication-cycle.test.mjs tests/cloud/account-login-v4-check.test.mjs => 32 passed, 0 failed (9 actual login-handler scenarios plus 23 adjacent contracts). Tests inject DOM/external IO, call real recovery/cycle kernels and keep synthetic records unchanged. Cases cover absent UUID, absent source mode, invalid timestamp, immutable conflict, retained transport, valid idle history with continued M4 observation, genuine M4 rejection, verified subset adoption and staged V4 recovery. This is not a full browser or real-account E2E claim.

Scoped yarn eslint src/sync/workspace-account-ui.ts tests/cloud/login-event-warning.test.mjs => PASS, 0 errors/warnings. git diff --check => PASS (Git only notes normal CRLF-to-LF normalization). No full Cloud/workspace repetition, matrix build, deployment or cloud-account creation. Existing CI configuration remains unchanged.

Remaining limitation: the reported account still fails event admission; this patch deliberately does not manufacture UUIDs, infer sourceMode, skip unknown rows or disable checks. The exact missing/invalid field is not known from the supplied combined error. Full V4 no-op remains valid evidence only for the checked snapshots. Do not report all-device event convergence. Any later compatibility repair must independently classify legacy rows versus invalid evidence and preserve every historical row and immutable event identity.

Development base bee3240ffcf1b120fab22bf43347e33698e29cc0. No etest/master update. Existing unrelated untracked .diagnostic/ and three login-sync logs are excluded. This commit contains the focused correction, tests and task/report; get its exact SHA from git history under fix(sync): avoid duplicate login event failure.
