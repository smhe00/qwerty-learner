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
