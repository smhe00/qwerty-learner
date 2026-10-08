# Qwerty Plus Cloud Sync V2 — Canonical Workspace Sync Specification

> Status: **canonical target specification; implementation pending**
>
> This document defines the next cloud-sync model. The current V1 implementation
> still exposes manual upload/download controls until this design is implemented.
>
> Core product rule:
>
> **one Sync ID owns one logical workspace; devices are replicas of that workspace.**
>
> **S0.5 executable specification:** `formal/sync/CloudSyncV2.tla` is the
> executable state-machine form of this protocol. Sync V2 implementation phases
> must refine that model rather than inventing independent transition semantics.

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
| Learn Block size | 20 logical words | 1 logical word | Automatic cloud-sync / internal Block granularity |

Rules:

1. values below 1 are invalid and must be normalized/rejected;
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

logicalFingerprint is SHA-256 of the canonical logical Backup V4 workspaceData and is
independent of gzip/Base64 representation. It includes durable database state,
DailySession/runtime, workspace settings, and navigation state. It excludes
transport/snapshot metadata such as createdAt, source-account hint, auth/session,
baseline, device identity, and compression representation. payloadSha256 is the
integrity hash of the actual stored payload bytes.

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
workspace settings, other dictionaries' records, global user preferences, or
already-earned account-level achievement state/history. Achievement state is
cleared only by full account reset/deletion.

#### Delete all dictionaries' learning records

This removes learning progress/history across all dictionaries but keeps the
workspace/account, ordinary settings, and already-earned account-level achievement
state/history. It is **not** a full account reset.

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

#### Cross-device deletion propagation

Full account deletion is global. Other devices may still physically contain an
older local account workspace until they next contact the service, but that copy
is no longer a valid account workspace once the server deletion has committed.

The server must retain a **minimal deletion tombstone** for the deleted immutable
account ID (userId/accountId). This tombstone exists only to propagate deletion
and reject stale clients. It must not contain learning records, settings, password
material, session secrets, or a recoverable account snapshot.

The username/login name is **not** the immutable identity. A deleted username may
be registered again later. A newly registered account using the same username
must receive a brand-new immutable account ID and a fresh account workspace.

Any stale device that later performs auth, sync, metadata refresh, app-start
account validation, or account-workspace activation must receive an explicit
terminal result such as:

~~~text
410 account_deleted
~~~

On receiving account_deleted, the client must:

1. stop all sync/write attempts for that deleted account;
2. mark the local account workspace as deleted/tombstoned immediately;
3. delete that account's local workspace snapshot, settings, baseline, and
   account-owned metadata;
4. if that workspace is active, switch the browser profile to anonymous;
5. broadcast the deletion to all tabs so no stale tab can keep writing it.

Anonymous and other accounts on the same device are untouched.

If another device is offline at the time of deletion, the service cannot erase
its storage remotely. The old local copy may therefore remain physically present
until that device reconnects. It is treated as a stale offline replica, not as a
surviving account. Once deletion is observed, it must be purged and must never be
uploaded to recreate or repopulate the deleted account.

Deletion wins over unsynchronized stale-device changes. Therefore the destructive
confirmation UI must warn that unsynced data on other devices will also be lost
unless the user first synchronizes or manually exports Backup V4 from those
devices.

The deletion tombstone is protocol metadata only. Its purpose is delete
propagation and anti-resurrection; it is not considered retained account
business data.

The deleted immutable account ID must never be reused, and the tombstone (or an
equivalent permanent anti-resurrection mechanism) must remain authoritative for
that deleted ID. The human-readable username may be reused by a newly registered
account, but that new account is a different identity and must never inherit the
old account's tombstone, workspace, baseline, revisions, or stale-device data.




#### Username reuse and identity-keying

All workspace ownership, local account-workspace keys, sync baselines, cloud
revision namespaces, deletion tombstones, and stale-device checks must be keyed
by immutable account ID, **never by username alone**.

Example:

~~~text
old account:
  username = alice
  accountId = U100
  -> deleted
  -> tombstone(U100)

later:
  register username = alice
  accountId = U847
  -> new empty/newly-seeded workspace
~~~

A stale device holding U100 must receive account_deleted and purge U100 even if
the username "alice" now belongs to U847.

The existence of the new username mapping must never authorize, migrate, merge,
or attach U100's stale local data to U847.

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




### 10.3 V3 -> V4 migration policy

V4 is write-only for new Sync V2 commits: after migration, new cloud/manual
snapshots are always V4.

V3 remains read-compatible only for one-way migration:

- import the V3 database and its currentDict/currentChapter state;
- synthesize missing V4-only durable runtime/settings fields deterministically;
- when upgrading on the same browser profile, existing persistent user-facing
  settings may seed WorkspaceSettingsV1;
- when no prior settings exist, use product defaults;
- missing DailySession/runtime is treated as absent, never fabricated;
- after the first successful V4 commit, V4 becomes the account's canonical
  snapshot format.

V3 and V4 logical fingerprints are not compared as if they were the same schema.
A V3 account must be migrated before V4 fingerprint/no-op semantics apply.

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
  ! 账号已删除，正在清理本机副本
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
3. Routine automatic Learn payload sync occurs no more frequently than Block boundaries;
   explicit operations such as delete/restore/logout reconciliation may trigger an immediate Sync.
4. Manual Sync may commit the latest durable logical-word state inside a Block.
5. Equal local/cloud state causes no snapshot payload transfer.
6. A stale device cannot silently overwrite a newer cloud revision.
7. Cloud failure cannot roll back local Learn completion.
8. DailySession progress is independent of cloud-sync timing.
9. Block-size configuration has a hard minimum of 1 logical word.
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
30. Full account deletion is terminal across devices: a stale device must purge
    the deleted account workspace after receiving account_deleted.
31. A deletion tombstone may retain only minimal anti-resurrection protocol
    metadata and must never retain recoverable account business data.
32. Usernames may be reused after account deletion, but immutable account IDs
    must never be reused.
33. Workspace ownership, revisions, baselines, tombstones, and stale-device
    protection must be keyed by immutable account ID rather than username.




## 13. Canonical state models

### 13.1 Workspace state

~~~text
ANONYMOUS
ACCOUNT_ACTIVE
ACCOUNT_AUTH_REQUIRED
WORKSPACE_SWITCHING
~~~

### 13.2 Sync state

~~~text
CLEAN
LOCAL_DIRTY
REMOTE_AHEAD
SYNCING
CONFLICT
OFFLINE
AUTH_REQUIRED
ACCOUNT_DELETED
~~~

### 13.3 Account/workspace transition state

~~~text
IDLE
SAVING_SOURCE
SYNCING_SOURCE
LOADING_TARGET
CHECKING_REMOTE
RECONCILING
COMMITTING_SWITCH
DONE
FAILED
~~~

Implementations may add internal substates, but must preserve these observable
semantics.

## 14. Implementation order

### S0 — Backup V4 and canonical workspace schema

- define qwerty-backup-v4;
- define WorkspaceSettingsV1 whitelist;
- include durable DailySession/runtime state;
- define canonical logicalFingerprint;
- extend remote metadata with logicalFingerprint separate from payloadSha256;
- define V3 -> V4 migration/compatibility policy.

### S0.5 — End-to-end executable TLA+ protocol

- model one logical EdgeOne service and multiple browser-profile devices;
- cover anonymous/account workspaces, immutable account IDs and username reuse;
- cover local logical-word advancement and frozen Block boundaries;
- cover automatic Block sync and manual logical-word sync;
- cover local/cloud revisions, equal-fingerprint no-op, remote-ahead and conflict;
- cover Backup V4 export/restore and explicit overwrite/recovery;
- cover offline/online, auth loss, process crash and sync crash windows;
- cover learning-record deletion and cross-device full-account deletion propagation;
- cover multi-device stale replicas and anti-resurrection tombstones;
- provide bounded exhaustive TLC configurations including 3 devices and 4
  username values;
- require mutation counterexamples for stale ordinary writes, immutable account-ID
  reuse, and active-Block retargeting.

**Gate (2026-10-09 conditional freeze):** S0.5 is the executable canonical
protocol baseline, formal verification status **PARTIAL**. Mandatory CI keeps
the existing bounded production/Block/identity/backup/two-device TLC checks
and negative mutation controls. The 3-device/4-username bounded `NextScale`
exploration is deferred to `tla-scale-exploration.yml` and does NOT gate S1.
No full-protocol proof or exhausted 3x4 state space is claimed. All S1–S4 code
must refine the S0.5 transitions; protocol changes require explicit review.
See `docs/S1_WORKSPACE_ISOLATION_IMPLEMENTATION.md`.
S1-S4 implementation must remain conformant with the executable protocol.

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

- configurable Block size, default 20, minimum 1;
- freeze Block size at Block creation;
- automatic safe full-snapshot sync at durable Block settlement;
- no obsolete per-Block retry queue;
- avoid duplicate Daily-complete commit when fingerprint is unchanged.

### S4 — destructive operations and multi-device hardening

- delete one dictionary's learning records;
- delete all learning records while retaining settings/account;
- full cloud+local account deletion;
- cross-device account-deletion tombstone propagation keyed by immutable account ID;
- safe username reuse with a fresh immutable account ID;
- stale-device deletion-resurrection protection;
- multi-device sessions;
- stable device identity;
- network/auth/session-expiry recovery;
- fuzz/crash/reload/multi-tab/network-partition/revision-conflict tests.

Incremental/record-level CRDT sync remains explicitly out of scope until measured
snapshot size or usage demonstrates that full Backup V4 snapshots are no longer
appropriate.
