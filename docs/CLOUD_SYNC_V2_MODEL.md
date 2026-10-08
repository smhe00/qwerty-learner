# Qwerty Plus Cloud Sync V2 — Unified Progress Model

> Status: **canonical target specification; implementation pending**
>
> This document defines the next cloud-sync model. The current V1 implementation
> still exposes manual upload/download controls until this design is implemented.
>
> Core product rule:
>
> **one Sync ID owns one logical workspace; devices are replicas of that workspace.**

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
3. each Block freezes its target size when that Block is created;
4. changing Block size affects only future Blocks and never changes an active Block;
5. changing Block size must never change a frozen DailySession denominator;
6. Block size must never reduce manual sync to Block granularity.

The same future-object-only rule applies to other frozen planning parameters such
as daily new-word target: editing or remotely synchronizing the setting affects
future DailySessions, not a DailySession that has already been created.

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

If an automatic Block sync fails, the client does not enqueue that old full
snapshot. Because Sync V2 uses full workspace snapshots, the next successful
safe sync publishes the latest durable workspace and subsumes earlier failed
Block snapshots.


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

### 7.1 Canonical logical fingerprint

Sync V2 cloud metadata must expose both:

~~~text
revision
logicalFingerprint
payloadSha256
clientFormatVersion
updatedAt
deviceId
sizeBytes
~~~

logicalFingerprint is SHA-256 of the canonical logical workspace content and is
independent of gzip/Base64 representation. payloadSha256 is the integrity hash of
the stored payload bytes.

Manual Sync can therefore perform a metadata-only no-op when local and cloud
logicalFingerprint are equal, even if the client's baseline revision needs to be
advanced.

The local baseline records at least baseRevision, logicalFingerprint, and
syncedAt. It is synchronization metadata, not portable workspace content.


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

For a newly registered account when anonymous has meaningful data, the product
must ask explicitly:

~~~text
检测到当前本机已有匿名学习数据。

[复制当前本机进度到新账号]
[建立空白账号]
~~~

Copying creates the new account workspace from the latest durable anonymous
workspace state and does not silently destroy the anonymous workspace. Existing-
account login never automatically absorbs anonymous data.

For login/re-login of an existing account, activation follows this matrix:

| Local account workspace | Cloud state | Required action |
| --- | --- | --- |
| absent | absent | create empty account workspace |
| absent | present | restore cloud workspace |
| present, same logical fingerprint | present | update baseline only; no payload transfer |
| present clean | cloud newer | restore cloud workspace |
| present dirty | cloud unchanged | push latest local workspace |
| present dirty | cloud newer/different | conflict/recovery |
| present | cloud absent | push local if meaningful; otherwise keep empty |

Anonymous data is outside this matrix unless the user explicitly chooses the
copy/migration action above.


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

The implementation must use an explicit WorkspaceSettings schema/whitelist. It
must never copy all localStorage keys indiscriminately.

The initial whitelist includes user-facing persistent preferences such as Memory
settings (daily target and Block size), loop, key/hint/correct/wrong sound,
pronunciation, phonetic, font/display, dark/light, random practice, translation
visibility, previous/next-word visibility, ignore-case, hover-answer,
text-selectable, dictation, current dictionary, and current chapter.

Explicitly excluded are auth/session tokens, sync baselines, stable device ID,
reviewModeInfo route/cache state, developer diagnostics, transient modal/panel
state, transient network/sync state, and implementation-only caches.

Any newly added persistent parameter must be explicitly classified as
workspace-scoped or device/runtime-scoped before it may be synchronized.


### 8.5 Deleting learning records

"Delete learning records" always acts on the **currently active workspace** and
deletes learning history/progress only. Ordinary settings and account identity
remain unchanged.

#### Delete one dictionary

For dictionary X, deletion includes all durable learning state that belongs to X,
including at least:

- wordRecords[X];
- chapterRecords[X];
- reviewRecords[X];
- reviewWordStates[X];
- DailySession[X];
- unfinished Learn checkpoints/runtime for X;
- derived per-dictionary learning state that cannot remain valid after those
  records are removed.

It does not delete the dictionary resource itself, account/auth/session, ordinary
workspace settings, other dictionaries' records, or global user preferences.

#### Delete all dictionaries' learning records

This removes learning progress/history across all dictionaries but keeps the
workspace/account and its ordinary settings. It is **not** a full account reset.

For an account workspace, either deletion is a revisioned state mutation and
must:

1. become durable locally immediately;
2. mark the workspace dirty;
3. trigger an immediate safe Sync attempt rather than wait for the next Block.

If offline, the local deletion remains valid and pending. A stale device based on
an older cloud revision must never silently resurrect deleted learning records.


### 8.6 Explicit logout versus auth/network failure

Only an explicit user logout switches an account workspace to anonymous.

The following do not change workspace ownership:

- network offline;
- EdgeOne unavailable;
- token expired;
- session revoked;
- transient authentication-check failure.

If account A is active and authentication becomes unusable:

~~~text
account:A remains active locally
sync status = AUTH_REQUIRED
~~~

The UI must offer a clear re-authentication path and an explicit logout-to-
anonymous action. It must never silently switch to anonymous because auth or
network availability changed.

### 8.7 User-visible account/workspace transition

Account/workspace switching is not a silent storage swap. The UI must expose
meaningful progress and the final result, for example:

~~~text
正在保存当前本机进度…
正在同步账号 A…
正在切换账号…
正在加载账号 B 的本机进度…
正在检查云端最新进度…
切换完成
~~~

Failure must also be visible and must identify what remains active.

For explicit logout from account A:

1. flush the latest durable logical-word checkpoint;
2. if A is dirty, attempt one manual-grade Sync to logical-word precision;
3. show the syncing state;
4. on success/no-op, switch to anonymous;
5. on failure, offer retry or "仍然退出".

"仍然退出" is allowed only if A's unsynced local workspace is preserved intact
for the next login/reconciliation.

Switching A -> B is always:

~~~text
A active
  -> explicit logout workflow
  -> anonymous active
  -> authenticate B
  -> reconcile B local/cloud state
  -> activate B
~~~

Registration remains forbidden until the explicit logout has returned the user
to anonymous.



### 8.8 Atomic workspace switching and multi-tab contract

Workspace switching is transactional from the user's perspective. A crash must
never leave the working IndexedDB ambiguously owned.

The implementation must use a durable switch journal or equivalent mechanism:

~~~text
PREPARE(source=A, target=anonymous/B)
  -> flush source logical checkpoint
  -> persist source workspace snapshot
  -> persist switch journal
  -> restore target workspace into working DB
  -> commit activeWorkspace pointer
  -> clear switch journal
  -> broadcast completion
~~~

On startup, an unfinished switch must be deterministically completed or rolled
back.

All tabs in one browser profile share exactly one activeWorkspace. A workspace
switch is mutually exclusive across tabs. BroadcastChannel + navigator.locks, or
an equivalent mechanism, may be used, but the behavioral contract is:

- no two tabs may believe different workspaces are active;
- switching pauses/rebinds other tabs;
- stale tabs must reload/rebind before further writes;
- no stale tab may continue writing the previous workspace into the shared DB.



### 8.9 Full account reset / account deletion

Deleting/resetting an account is the only normal operation that clears **all**
data owned by that account.

It deletes both cloud and local account state:

- cloud identity/auth/password versions;
- sessions;
- cloud revisions/snapshots;
- local account workspace;
- local account learning records;
- local account settings;
- local sync baseline and other account-owned local metadata.

Anonymous and other account workspaces are not affected.

If the user wants to preserve the account state, they must manually export a
Backup V4 file before deletion. The product does not create a hidden recovery
copy.

Account deletion requires online server confirmation. Safe order:

~~~text
optional manual Backup V4 export
  -> explicit destructive confirmation
  -> server deletes account identity/sessions/revisions
  -> server confirms success
  -> tombstone/delete local account workspace
  -> switch activeWorkspace to anonymous
~~~

If server deletion fails, local account data must not be destroyed. If server
deletion succeeds but local cleanup is interrupted, a local tombstone must
prevent that account workspace from becoming active again and cleanup resumes on
startup.

## 9. Device-switch semantics

The user-visible contract is:

- same device + same workspace: recover to the latest local logical-word checkpoint;
- another device after normal automatic sync: recover to the latest synchronized
  Block checkpoint;
- another device after a manual Sync: recover to the latest manually synchronized
  logical-word checkpoint.

The product must never claim that an unsynchronized local tail exists on another
device.

## 10. Backup V4 workspace payload, backup and restore

Sync V2 introduces the canonical full-workspace format:

~~~text
qwerty-backup-v4
~~~

V4 replaces V3 for Sync V2. V3 is retained only for explicitly supported
migration/historical restore.

Conceptually V4 contains:

~~~text
WorkspaceSnapshotV4
├── database
│   ├── wordRecords
│   ├── chapterRecords
│   ├── reviewRecords
│   ├── reviewWordStates
│   ├── achievementEvents
│   └── achievementStates
├── learnRuntime
│   └── durable DailySession state
├── settings
│   └── WorkspaceSettingsV1 whitelist
├── navigation
│   ├── currentDict
│   └── currentChapter
└── metadata
    ├── createdAt
    └── source workspace/account hint
~~~

DailySession is part of V4 because cross-device logical-word recovery is not
complete without the durable daily plan/session state.

Auth/session tokens, sync baseline, device ID, network state, transient UI state,
and developer diagnostics are excluded.

Cloud transfer remains full-snapshot based:

~~~text
Backup V4 logical workspace
  -> gzip
  -> Base64
  -> revisioned PUT /api/sync
~~~

Full payload transfer occurs only when state transfer is required:

- automatic dirty Block commit;
- manual Sync with local durable changes;
- restore when a newer cloud revision must be applied;
- explicit destructive mutation/restore that requires an immediate commit.

Equal logical fingerprints cause no snapshot payload transfer.

### 10.1 Manual backup

Manual export always captures exactly the **active workspace**:

- anonymous active -> backup anonymous workspace;
- account A active -> backup account A workspace.

Backup contains progress + durable runtime + settings + navigation state, but no
auth secrets/device-runtime state.

### 10.2 Manual restore

Restore targets exactly the currently active workspace and is a full workspace
replacement, not a record-level merge.

- anonymous restore remains local-only;
- account restore marks the account workspace dirty and immediately attempts a
  safe revisioned Sync;
- concurrent cloud change produces conflict/recovery instead of silent overwrite.

A backup whose source account differs from the active account is an explicit
cross-account import/migration and requires strong confirmation. Backup/restore
must never touch inactive local workspaces.


## 11. UI model

Normal state should be expressed in user terms:

~~~text
Cloud Sync
  ✓ 已同步
  ↑ 有本机更改等待同步
  ↻ 正在同步
  ↻ 正在切换账号
  ↓ 正在恢复账号进度
  ! 同步冲突，需要处理
  ! 需要重新登录
  ○ 离线，稍后自动同步

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

19. Network/auth failure must not silently switch an account workspace to anonymous.
20. Existing-account login must follow the local/cloud reconciliation matrix.
21. Workspace switching must be crash-safe and atomic from the user's perspective.
22. All tabs in one browser profile share one activeWorkspace.
23. Block-size and frozen planning parameter changes affect future objects only.
24. Backup V4 must include durable DailySession/runtime and the settings whitelist.
25. Cloud metadata must expose logicalFingerprint separately from payload hash.
26. Failed automatic Block sync must not enqueue obsolete full snapshots.
27. Delete-one-dictionary and delete-all-learning-records preserve ordinary settings/account.
28. Full account deletion removes both cloud and local data for that account.
29. Manual backup/restore operates on exactly one active workspace.


## 13. Implementation order

### S0 — Backup V4 and canonical workspace schema

- define qwerty-backup-v4;
- define WorkspaceSettingsV1 whitelist;
- include durable DailySession/runtime state;
- define canonical logicalFingerprint;
- extend remote metadata with logicalFingerprint separate from payloadSha256;
- define V3 -> V4 migration/compatibility policy.

### S1 — Local workspace isolation

- isolated anonymous/account local workspaces;
- crash-safe switch journal;
- one activeWorkspace per browser profile;
- multi-tab lock/broadcast/rebind;
- registration only from anonymous;
- new-account anonymous-copy decision;
- explicit logout versus AUTH_REQUIRED semantics.

### S2 — Unified manual Sync

- one normal Sync action;
- metadata-only no-op on equal logical fingerprints;
- login/re-login reconciliation matrix;
- push/pull/conflict behavior;
- visible account-switch progress/success/failure;
- workspace-scoped Backup V4 export/restore.

### S3 — Block automatic sync

- configurable Block size, default 20, minimum 10;
- freeze Block size at Block creation;
- automatic safe full-snapshot sync at durable Block settlement;
- no obsolete per-Block retry queue;
- avoid duplicate Daily-complete commit when fingerprint is unchanged.

### S4 — destructive operations and multi-device hardening

- delete one dictionary's learning records;
- delete all learning records while retaining settings/account;
- full cloud+local account deletion;
- stale-device deletion-resurrection protection;
- multi-device sessions;
- stable device identity;
- network/auth/session-expiry recovery;
- fuzz/crash/reload/multi-tab/network-partition/revision-conflict tests.

Incremental/record-level CRDT sync remains explicitly out of scope until measured
snapshot size or usage demonstrates that full Backup V4 snapshots are no longer
appropriate.
