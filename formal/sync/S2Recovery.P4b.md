# S2 explicit recovery — P4b-1 bounded TLA+ projection

`S2Recovery.tla` extends the older `CloudSyncV2.tla` state-machine
projection with P3b semantics omitted from the original S0.5 specification:
explicit two-backup acknowledgement, per-account confirmation, an immutable
durable Pull journal, replay after crash, account switching fence, auth loss,
remote revision races, and CAS recovery writes.

This model abstracts actual payload fingerprints as a revision. It DOES NOT
prove gzip checksums, Dexie row completeness, physical IndexedDB atomicity,
or real cross-tab Web Lock correctness. Those require P4b-0 audit and P4b-2
browser tests.

Safety invariants checked:
- JournalOwnerSafe: a pending Pull may not change account owners.
- NoMixedMountedReplica: journal-pending partial restores may not mount.
- BaselineMonotonicWithCloud: baseline never moves beyond cloud revision.
- NoUnauthorizedCloudOverwrite: recovery requires backup, consent and CAS.

`S2Recovery.unsafe-mutation.cfg` enables a deliberately unsafe overwrite.
It MUST produce a `NoUnauthorizedCloudOverwrite` counterexample, not a
silent pass, timeout, or unrelated parsing error.

The small profile `S2Recovery.production.cfg` is used for fast exhaustive
verification. The 2-device/2-account profile is an additional scalability
projection and must be separately bounded before being called complete.
