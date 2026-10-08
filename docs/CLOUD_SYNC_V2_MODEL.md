# Qwerty Plus Cloud Sync V2 — Unified Progress Model

> Status: **approved design, implementation pending**
>
> This document defines the next cloud-sync model. The current V1 implementation
> still exposes manual upload/download controls until this design is implemented.
>
> Core product rule:
>
> **one Sync ID owns one logical learning progress; devices are replicas of that progress.**

## 1. Goals

Cloud sync is not a backup workflow. Its primary purpose is to let the same Sync
ID continue the same learning progress across devices without requiring the user
to decide whether to upload or download.

The product remains local-first:

- signed out: all learning works from local IndexedDB only;
- signed in: local IndexedDB remains the real-time working copy;
- cloud state coordinates progress across devices;
- network or EdgeOne failure must never block Learn, Typing, FSRS, or local recovery.

## 2. Two durability granularities

Qwerty deliberately uses different local and cloud checkpoint granularities.

### 2.1 Local durability: logical-word checkpoint

After each authoritative logical-word transition, all required Learn/Review state
is persisted locally before the next word becomes authoritative.

Therefore same-device reload/crash/close recovery resumes from the latest durable
logical-word checkpoint.

~~~text
logical word complete
        |
        v
local durable checkpoint
        |
        v
next logical word
~~~

Partial character input may be lost. A completed logical word must not be lost or
replayed as unfinished.

### 2.2 Automatic cloud durability: Block checkpoint

Automatic payload sync is triggered at a completed Learn Block boundary.

~~~text
word checkpoints ... word checkpoints
               |
               v
         Block complete
               |
               v
       automatic cloud sync
~~~

Without a manual sync, a different device is guaranteed to resume from the latest
successfully cloud-synchronized checkpoint, normally the latest completed Block.

**Block is only the automatic cloud-sync cadence in the sync protocol.** It does
not weaken local logical-word durability and does not constrain manual sync
granularity.

## 3. Block-size memory parameter

The Memory settings own a configurable Learn Block size:

| Parameter | Default | Minimum | Meaning |
| --- | ---: | ---: | --- |
| Learn Block size | 20 logical words | 10 logical words | Automatic cloud-sync / internal Block granularity |

Rules:

1. values below 10 are invalid and must be normalized/rejected;
2. existing product default remains 20;
3. changing Block size changes future Block construction, not already durable
   logical-word checkpoints;
4. Block size must never change DailySession progress semantics;
5. Block size must never reduce manual sync to Block granularity.

No upper bound is specified by this design document; implementation may define a
safe UI bound separately if needed.

## 4. One user action: Sync

The normal cloud UI must not expose separate **Upload** and **Download** actions.

It exposes one operation:

~~~text
[ Sync ]
~~~

The sync engine determines direction from local fingerprint, cloud metadata,
known base revision, and current revision.

Normal users should not need to understand revision numbers or choose a transfer
direction.

### 4.1 No-op sync

Manual Sync first compares state using lightweight metadata/fingerprint logic.

If local and cloud are already logically identical:

~~~text
local fingerprint == synchronized cloud fingerprint
AND no newer remote revision
~~~

then Sync completes as a no-op.

**No snapshot payload is uploaded or downloaded.** A lightweight metadata request
is allowed.

### 4.2 Local newer, cloud unchanged

If local state has durable changes and cloud has not changed since the local
baseline, manual Sync uploads one current full snapshot.

The snapshot represents the **latest durable logical-word checkpoint**, even when
the user is in the middle of a Block.

Therefore manual Sync can intentionally make cross-device recovery finer than the
automatic Block boundary.

### 4.3 Cloud newer, local clean

If cloud has a newer revision and local has no unsynchronized durable changes,
Sync downloads/restores the cloud snapshot and advances the local baseline.

### 4.4 Both sides changed

A revision/fingerprint divergence must never silently overwrite either side.

The normal UI still remains a single Sync operation. If automatic reconciliation
is unsafe, Sync enters an explicit conflict/recovery state. Directional
upload/download controls, if retained for diagnostics or disaster recovery,
belong only in an advanced recovery surface and are not part of the normal sync
workflow.

## 5. Automatic sync

Automatic payload sync is deliberately sparse.

### Trigger

~~~text
Block durable settlement
        |
        v
local state is dirty
        |
        v
cloud baseline still current
        |
        v
upload one full gzip snapshot
~~~

A DailySession completion that coincides with the final Block does not require a
second identical upload.

There is no periodic 10-second/30-second full-snapshot timer in V2.

There is no per-character or per-logical-word automatic payload upload.

Lightweight remote metadata checks may occur at safe lifecycle points such as:

- login;
- application start;
- before starting/resuming Learn;
- explicit manual Sync.

Metadata checks are not snapshot transfers.

## 6. Manual sync is logical-word granular

Manual Sync is intentionally different from automatic sync.

Example:

~~~text
Block size = 20

Cloud last auto checkpoint: Block 5 complete

Device A starts Block 6:
  word 1 complete  -> local checkpoint
  word 2 complete  -> local checkpoint
  ...
  word 8 complete  -> local checkpoint

user presses Sync
        |
        v
cloud snapshot now contains Block 6 through word 8
~~~

If Device B then synchronizes, it can resume from the manually synchronized
logical-word checkpoint rather than restarting Block 6.

Therefore:

> **Block controls automatic sync frequency, not the maximum precision of cloud state.**

## 7. Cross-device authority

Every cloud snapshot has a monotonically increasing revision. A device keeps the
revision/fingerprint of the cloud state from which its current local branch was
derived.

A stale device must not overwrite a newer cloud revision.

Conceptually:

~~~text
baseRevision == cloudRevision
        |
        +-- local dirty --> safe push
        |
        +-- local clean --> no-op

cloudRevision > baseRevision
        |
        +-- local clean --> pull latest cloud state
        |
        +-- local dirty --> divergence / recovery path
~~~

The server continues to enforce optimistic concurrency on snapshot writes.

## 8. Local workspace and account switching

Cloud identity and local learning data use an explicit workspace rule.

~~~text
signed out        -> active workspace = anonymous
signed in as A    -> active workspace = account:A
logout A          -> active workspace = anonymous
signed in as B    -> active workspace = account:B
~~~

Each workspace is independently persisted. Login/logout switches the active
workspace; it does not implicitly merge learning records between workspaces.

Only an account workspace participates in cloud synchronization. The anonymous
workspace is always local-only.

### 8.1 Account switching

Different accounts must never share the same logical local progress.

Switching from account A to account B is defined as:

~~~text
A active
  -> logout
  -> anonymous active
  -> login B
  -> B active
~~~

The implementation may optimize the physical storage mechanism, but the logical
contract is that anonymous, account:A, account:B, and any other account
workspaces are isolated.

### 8.2 Registration while already authenticated

Registration is allowed only from the signed-out anonymous workspace.

If account A is currently authenticated, the product must not offer or execute a
"register new account" flow inside A's active workspace.

Required flow:

~~~text
account:A active
  -> logout
  -> anonymous active
  -> register new account C
  -> account:C active
~~~

This prevents account A's local progress from being implicitly inherited by a
newly registered account.

### 8.3 Anonymous data at login/registration

Anonymous progress is not automatically merged into an existing account.

If a first-time account binding wants to adopt anonymous progress, that must be
an explicit one-time migration decision. Outside that explicit migration,
workspace switching preserves isolation.

### 8.4 Account-scoped settings

A workspace owns not only learning records but also the user's persistent
product settings.

Therefore switching workspace must switch both:

~~~text
learning progress
+
persistent user settings
~~~

Examples of account/workspace-scoped settings include:

- Memory settings, including daily new-word target and Learn Block size;
- Typing preferences;
- pronunciation / phonetic / key-sound / hint-sound preferences;
- font / display / answer-visibility preferences;
- dictation/random/loop preferences;
- current dictionary and current chapter;
- other persistent user-facing product parameters.

The logical rule is:

~~~text
signed out
  -> anonymous progress + anonymous settings

login A
  -> account:A progress + account:A settings

logout A
  -> anonymous progress + anonymous settings

login B
  -> account:B progress + account:B settings
~~~

Settings from account A must never leak into account B or anonymous mode.

Account-scoped settings participate in the account snapshot/fingerprint and
therefore follow the account across devices.

Device/runtime-only state is not account-scoped and must not be copied through
the cloud snapshot. Examples include authentication tokens, stable device ID,
network state, transient UI state, and developer diagnostics.

A setting change is durable locally immediately and marks the active workspace
dirty. It must eventually be included in the next safe cloud commit; manual Sync
must include the latest durable settings even inside an unfinished Block.

### 8.5 Deleting learning records

"Delete learning records" always acts on the **currently active workspace**.

- signed out: delete only anonymous local learning data;
- signed in as A: delete only account A's learning data;
- account A deletion must never affect anonymous or account B data.

For an account workspace, deleting one dictionary or all learning records is a
revisioned state mutation and should trigger an immediate sync attempt rather
than waiting for the next automatic Block boundary.

If the network is unavailable, the deletion remains durable locally and pending
for account sync. A stale device must never silently resurrect records deleted by
a newer cloud revision.

## 9. Device-switch semantics

The user-visible contract is:

- same device: recover to the latest local logical-word checkpoint;
- another device after normal automatic sync: recover to the latest synchronized
  Block checkpoint;
- another device after a manual Sync: recover to the latest manually synchronized
  logical-word checkpoint.

The product must never claim that an unsynchronized local tail exists on another
device.

## 10. Payload model

V2 keeps the current full-snapshot transport initially:

~~~text
IndexedDB
  -> qwerty-backup-v3
  -> gzip
  -> Base64
  -> PUT /api/sync
~~~

The important optimization is **when** payloads move, not a premature move to
record-level CRDT/incremental sync.

Full payload transfer occurs only when a real state transfer is required:

- automatic dirty Block commit;
- manual Sync with local durable changes;
- pull when a newer cloud revision must be restored.

An equal-state manual Sync performs no snapshot transfer.

## 11. UI model

Normal state should be expressed in user terms:

~~~text
Cloud Sync
  ✓ Synced
  ↻ Syncing
  ↑ Local changes waiting for sync
  ! Sync conflict requires recovery

[ Sync ]
~~~

The normal UI must not ask the user to choose "upload local" versus "download
cloud".

Backup/export remains a separate disaster-recovery capability and must not be
presented as the normal cross-device synchronization mechanism.

## 12. Required invariants

1. Local learning never waits for cloud availability.
2. Every authoritative logical-word transition remains locally durable.
3. Automatic payload sync occurs no more frequently than Block boundaries.
4. Manual Sync may commit the latest durable logical-word state inside a Block.
5. Equal local/cloud state causes no snapshot payload transfer.
6. A stale device cannot silently overwrite a newer cloud revision.
7. Cloud failure cannot roll back local Learn completion.
8. DailySession progress is independent of cloud-sync timing.
9. Block-size configuration has a hard minimum of 10 logical words.
10. The normal cloud UI has one synchronization action, not directional
    upload/download actions.
11. Signed-out mode always uses the isolated anonymous local workspace.
12. Signed-in mode always uses the authenticated account's isolated local workspace.
13. Login/logout/account switching must not implicitly merge workspaces.
14. Registration is allowed only after returning to the signed-out anonymous workspace.
15. Learning-record deletion affects only the active workspace; stale devices must not
    silently resurrect a deletion committed by a newer cloud revision.
16. Persistent user-facing settings belong to the active workspace and switch with it.
17. Account-scoped settings must follow the same account across devices and must not leak
    between anonymous/account workspaces.
18. Device/runtime-only state such as auth tokens, device identity, transient UI state,
    and developer diagnostics must not be cloud-synchronized as account settings.

## 13. Implementation phases

### Phase S1 — contract and parameter

- add the Block-size memory parameter, default 20, minimum 10;
- bind future Block construction to the parameter;
- add executable contracts for the invariants above.

### Phase S2 — single Sync operation

- replace normal upload/download controls with one Sync action;
- implement metadata-only no-op when already synchronized;
- retain explicit recovery only for true divergence.

### Phase S3 — automatic Block sync

- trigger safe automatic snapshot sync after durable Block settlement;
- avoid a duplicate DailySession-complete upload when the final Block already
  produced the same snapshot;
- check remote metadata before starting/resuming Learn.

### Phase S4 — workspace and multi-device hardening

- implement isolated anonymous/account local workspaces for both learning progress and persistent settings;
- require logout to anonymous before registering another account;
- bind delete-one-dictionary / delete-all-records to the active workspace;
- allow the same Sync ID to authenticate on multiple devices;
- add stable device identity;
- fuzz/test stale-device, crash, reload, network-partition, and revision-conflict
  scenarios.

Incremental/record-level cloud sync is explicitly out of scope until measured
snapshot size or usage requires it.
