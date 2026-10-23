# Single-session, three-device offline branch relay E2E

## Product requirement

Only **one** session per account is valid at a time. A later login revokes
earlier device tokens; offline learning is not blocked. No multi-session M1
authorization should be enabled, even on etest.

After going back online, the current authenticated client should automatically
publish its durable attempts. A device whose token is revoked must NOT upload,
wipe, silently assign data to an anonymous account, or discard pending
records. When the user explicitly reauthenticates on that same account, all
preserved local account data must be automatically merged (no manual sync or
merge choice). Same-word Good/Again attempts are distinguished by immutable
UUID and scheduler replay, not by timestamp deduplication.

## Mandatory black-box E2E

- A logs in, enters genuine Learn, goes offline, writes attempt A.
- B logs in (A now revoked), enters Learn, goes offline, writes B.
- C logs in (B now revoked), enters Learn, goes offline, writes C.
- All three connections resume. A/B must receive authenticated 401
  session_revoked while their original IndexedDB attempt rows remain intact.
  C alone holds a valid token.
- A, B, C then reauthenticate **sequentially** as required by the
  single-session policy. Nothing calls the manual Sync button, fake merge
  APIs, IndexedDB write adapters, or synthetic V4 overwrite. Verify the
  exact union of A/B/C immutable events in the active RecordDB.
- On failure, only the unique disposable etest account may be deleted.
  This is a deliberately RED test until M4 automatic V4 adoption is wired.

## Companion transport and three-way data-integrity tests

The single-session M3 relay uses A -> B -> A authentication: revoked
bearers must receive 401, valid bearers must read cross-device exact Blob
receipts, and all immutable attempted events must remain deduplicated.
It proves event transport, **not** complete local convergence.

The separate six-table real Blob/CAS test starts three snapshots from
one verified ancestor, forces two stale 409 revisions (or verified
pre-write 503), uses explicit *test-only* merge and CAS, verifies
ChapterRecord numeric FK rebasing, and independently downloads the
full event union on a fourth device. It does not substitute for a
real auto-reconciliation pass.

Any missing history, non-authoritative POP enumeration, uncertain 503,
broken session lineage, account mismatch or FSRS incompatibility must
fail closed and preserve original local snapshots. No production master
release may be inferred from a passed event-transport pilot.

## Event transport staging admission without environment flags (2026-10-23)

**Single active login remains a hard product invariant.** Signing into device B
revokes A's token. Any offline attempts on A remain stored locally; the user
may explicitly reauthenticate A to continue authorized upload. The project
does NOT enable multi-session login.

The authenticated immutable-event API is always available on deployments
containing the new gateway code. This removes both
`MULTI_DEVICE_EVENT_PILOT_ENABLED` (Maker project) and
`VITE_QWERTY_M3_PILOT_AUTO` (frontend build) as rollout requirements.
Nothing must be configured manually in Maker to run event-relay verification.

The **browser publisher remains limited to the actual HTTPS
`etest.edgeone.dev` hostname**; ordinary production and Pages frontends do
not initiate M3 publishing. Backend endpoints remain available to valid bearer
tokens but never grant V4 overwrite permission; account/device and immutable
receipt checks are mandatory. Revoked tokens return 401.

On isolated etest, `GET /api/health` must return:

- `authMode=single-active-session`
- `eventPilotMode=immutable-events-only`
- capability `single-session-event-no-env-v1`

The Maker runtime may present a different internal hostname in diagnostic
`pilotRequestHost`; it is **never** an authorization boundary. Preflight
checks those three API facts before test-account creation, not an environment
variable. A static-only deployment is insufficient.

**Not an authorization to release:** verified M3 receipts do not mean the
full six-table V4 has been adopted in any other local database. The hard
three-browser offline split/reconnect/reauth test must independently show the
exact immutable union in active RecordDB, with rollback and no-loss proof,
before promoting to `master`.
