---- MODULE CloudSyncV2 ----
EXTENDS Naturals, FiniteSets

(*
  Cloud Sync V2 end-to-end executable protocol model.

  Each Device models one browser profile. Tabs are intentionally collapsed into
  that single browser-profile state because the product contract requires every
  tab in one profile to share one activeWorkspace.

  The six-tuple fingerprint is an abstraction of Backup V4 workspaceData:
    << durableLearning, settingsVersion, blockSizeSetting,
       frozenBlockTarget, blockProgress, blockEpoch >>

  Equality of these tuples models equality of canonical logicalFingerprint.
  gzip/Base64/payload hashes are transport details and are intentionally absent.
*)

CONSTANTS
  Devices,
  Usernames,
  AccountIds,
  MaxWords,
  MaxRevision,
  MaxSettingVersion,
  MaxBlockSize,
  MaxBlockEpoch,
  DefaultBlockSize,
  PushPolicy,
  IdReusePolicy,
  BlockChangePolicy

ASSUME
  /\ Devices # {}
  /\ Usernames # {}
  /\ AccountIds # {}
  /\ MaxWords >= 1
  /\ MaxRevision >= 1
  /\ MaxSettingVersion >= 0
  /\ MaxBlockSize >= 1
  /\ MaxBlockEpoch >= 1
  /\ DefaultBlockSize \in 1..MaxBlockSize
  /\ PushPolicy \in {"safe", "allow-stale"}
  /\ IdReusePolicy \in {"forbid", "allow-reuse"}
  /\ BlockChangePolicy \in {"future-only", "retarget-current"}

Anon == "anonymous"
None == "none"

ASSUME
  /\ Anon \notin AccountIds
  /\ None \notin AccountIds
  /\ Anon # None

Workspaces == AccountIds \cup {Anon}
AccountOrNone == AccountIds \cup {None}

SyncStates ==
  {"CLEAN", "LOCAL_DIRTY", "REMOTE_AHEAD", "SYNCING",
   "CONFLICT", "OFFLINE", "AUTH_REQUIRED", "ACCOUNT_DELETED"}

SwitchStates == {"IDLE", "LOGOUT_PENDING"}

RawFingerprints ==
  (0..MaxWords)
    \X (0..MaxSettingVersion)
    \X (1..MaxBlockSize)
    \X (1..MaxBlockSize)
    \X (0..MaxBlockSize)
    \X (0..MaxBlockEpoch)

Fingerprints ==
  { fp \in RawFingerprints : fp[5] < fp[4] }

Words(fp) == fp[1]
SettingVersion(fp) == fp[2]
BlockSizeSetting(fp) == fp[3]
BlockTarget(fp) == fp[4]
BlockProgress(fp) == fp[5]
BlockEpoch(fp) == fp[6]

DefaultFp ==
  <<0, 0, DefaultBlockSize, DefaultBlockSize, 0, 0>>

CompletesBlock(fp) ==
  BlockProgress(fp) + 1 = BlockTarget(fp)

CompleteWordFp(fp) ==
  IF CompletesBlock(fp)
  THEN << Words(fp) + 1,
          SettingVersion(fp),
          BlockSizeSetting(fp),
          BlockSizeSetting(fp),
          0,
          BlockEpoch(fp) + 1 >>
  ELSE << Words(fp) + 1,
          SettingVersion(fp),
          BlockSizeSetting(fp),
          BlockTarget(fp),
          BlockProgress(fp) + 1,
          BlockEpoch(fp) >>

ChangeSettingFp(fp) ==
  << Words(fp),
     SettingVersion(fp) + 1,
     BlockSizeSetting(fp),
     BlockTarget(fp),
     BlockProgress(fp),
     BlockEpoch(fp) >>

ChangeBlockSizeFp(fp, n) ==
  IF BlockChangePolicy = "future-only"
  THEN << Words(fp),
          SettingVersion(fp),
          n,
          BlockTarget(fp),
          BlockProgress(fp),
          BlockEpoch(fp) >>
  ELSE << Words(fp),
          SettingVersion(fp),
          n,
          n,
          BlockProgress(fp),
          BlockEpoch(fp) >>

ResetLearningFp(fp) ==
  <<0,
    SettingVersion(fp),
    BlockSizeSetting(fp),
    BlockSizeSetting(fp),
    0,
    0>>

ServerType ==
  [ owner      : [Usernames -> AccountOrNone],
    alive      : SUBSET AccountIds,
    tombstones : SUBSET AccountIds,
    revision   : [AccountIds -> 0..MaxRevision],
    fp         : [AccountIds -> Fingerprints] ]

DeviceType ==
  [ online     : BOOLEAN,
    up         : BOOLEAN,
    active     : Workspaces,
    auth       : AccountOrNone,
    authUsable : BOOLEAN,
    present    : SUBSET AccountIds,
    local      : [Workspaces -> Fingerprints],
    baseRev    : [AccountIds -> 0..MaxRevision],
    baseFp     : [AccountIds -> Fingerprints],
    lastAuto   : [AccountIds -> 0..MaxBlockEpoch],
    sync       : SyncStates,
    switch     : SwitchStates ]

BackupType ==
  [ present          : BOOLEAN,
    owner            : Workspaces,
    fp               : Fingerprints,
    importAuthorized : BOOLEAN ]

VARIABLES
  server,
  dev,
  backup,
  ordinaryWriteSafe,
  blockFreezeSafe

vars == <<server, dev, backup, ordinaryWriteSafe, blockFreezeSafe>>

LocalFp(d, w) == dev[d].local[w]
CloudFp(a) == server.fp[a]
BaseFp(d, a) == dev[d].baseFp[a]

LocalDirty(d, a) ==
  LocalFp(d, a) # BaseFp(d, a)

RemoteChanged(d, a) ==
  server.revision[a] # dev[d].baseRev[a]

CanUseAccount(d, a) ==
  /\ dev[d].up
  /\ dev[d].online
  /\ dev[d].active = a
  /\ dev[d].auth = a
  /\ dev[d].authUsable
  /\ a \in server.alive
  /\ a \in dev[d].present

AssessmentFor(d, a, fp) ==
  IF fp = CloudFp(a)
  THEN "CLEAN"
  ELSE IF fp = BaseFp(d, a) /\ RemoteChanged(d, a)
       THEN "REMOTE_AHEAD"
       ELSE IF fp # BaseFp(d, a) /\ ~RemoteChanged(d, a)
            THEN "LOCAL_DIRTY"
            ELSE "CONFLICT"

Assessment(d, a) ==
  AssessmentFor(d, a, LocalFp(d, a))

PushAllowed(d, a) ==
  \/ server.revision[a] = dev[d].baseRev[a]
  \/ PushPolicy = "allow-stale"

RegisterIdAllowed(a) ==
  /\ a \notin server.alive
  /\ (a \notin server.tombstones \/ IdReusePolicy = "allow-reuse")

Init ==
  /\ server =
       [ owner      |-> [u \in Usernames |-> None],
         alive      |-> {},
         tombstones |-> {},
         revision   |-> [a \in AccountIds |-> 0],
         fp         |-> [a \in AccountIds |-> DefaultFp] ]
  /\ dev =
       [d \in Devices |->
         [ online     |-> TRUE,
           up         |-> TRUE,
           active     |-> Anon,
           auth       |-> None,
           authUsable |-> FALSE,
           present    |-> {},
           local      |-> [w \in Workspaces |-> DefaultFp],
           baseRev    |-> [a \in AccountIds |-> 0],
           baseFp     |-> [a \in AccountIds |-> DefaultFp],
           lastAuto   |-> [a \in AccountIds |-> 0],
           sync       |-> "CLEAN",
           switch     |-> "IDLE" ]]
  /\ backup =
       [d \in Devices |->
         [ present          |-> FALSE,
           owner            |-> Anon,
           fp               |-> DefaultFp,
           importAuthorized |-> FALSE ]]
  /\ ordinaryWriteSafe = TRUE
  /\ blockFreezeSafe = TRUE

TypeOK ==
  /\ server \in ServerType
  /\ dev \in [Devices -> DeviceType]
  /\ backup \in [Devices -> BackupType]
  /\ ordinaryWriteSafe \in BOOLEAN
  /\ blockFreezeSafe \in BOOLEAN

OwnerPointsToLiveAccount ==
  \A u \in Usernames :
    \/ server.owner[u] = None
    \/ /\ server.owner[u] \in server.alive
       /\ server.owner[u] \notin server.tombstones

AccountIdNeverReused ==
  server.alive \cap server.tombstones = {}

ActiveWorkspacePresent ==
  \A d \in Devices :
    \/ dev[d].active = Anon
    \/ dev[d].active \in dev[d].present

AuthenticationMatchesWorkspace ==
  \A d \in Devices :
    IF dev[d].auth = None
    THEN TRUE
    ELSE /\ dev[d].auth = dev[d].active
         /\ dev[d].auth \in dev[d].present

AnonymousHasNoAuthentication ==
  \A d \in Devices :
    dev[d].active = Anon => dev[d].auth = None

AbsentAccountIsPurged ==
  \A d \in Devices :
    \A a \in AccountIds :
      a \notin dev[d].present =>
        /\ dev[d].local[a] = DefaultFp
        /\ dev[d].baseRev[a] = 0
        /\ dev[d].baseFp[a] = DefaultFp
        /\ dev[d].lastAuto[a] = 0

BlockMinimumOne ==
  \A d \in Devices :
    \A w \in Workspaces :
      /\ BlockSizeSetting(LocalFp(d, w)) >= 1
      /\ BlockTarget(LocalFp(d, w)) >= 1

AnonymousNeverCloudBacked ==
  Anon \notin DOMAIN server.fp

OrdinaryWritesUseCurrentBase ==
  ordinaryWriteSafe

BlockSettingDoesNotRetargetCurrentBlock ==
  blockFreezeSafe

Safety ==
  /\ TypeOK
  /\ OwnerPointsToLiveAccount
  /\ AccountIdNeverReused
  /\ ActiveWorkspacePresent
  /\ AuthenticationMatchesWorkspace
  /\ AnonymousHasNoAuthentication
  /\ AbsentAccountIsPurged
  /\ BlockMinimumOne
  /\ AnonymousNeverCloudBacked
  /\ OrdinaryWritesUseCurrentBase
  /\ BlockSettingDoesNotRetargetCurrentBlock

RegisterBlank(d, u, a) ==
  /\ dev[d].up
  /\ dev[d].online
  /\ dev[d].active = Anon
  /\ server.owner[u] = None
  /\ RegisterIdAllowed(a)
  /\ server' =
       [server EXCEPT
          !.owner[u] = a,
          !.alive = @ \cup {a},
          !.revision[a] = 1,
          !.fp[a] = DefaultFp]
  /\ dev' =
       [dev EXCEPT
          ![d].active = a,
          ![d].auth = a,
          ![d].authUsable = TRUE,
          ![d].present = @ \cup {a},
          ![d].local[a] = DefaultFp,
          ![d].baseRev[a] = 1,
          ![d].baseFp[a] = DefaultFp,
          ![d].lastAuto[a] = 0,
          ![d].sync = "CLEAN",
          ![d].switch = "IDLE"]
  /\ UNCHANGED <<backup, ordinaryWriteSafe, blockFreezeSafe>>

RegisterCopyAnonymous(d, u, a) ==
  LET fp == LocalFp(d, Anon) IN
    /\ dev[d].up
    /\ dev[d].online
    /\ dev[d].active = Anon
    /\ server.owner[u] = None
    /\ RegisterIdAllowed(a)
    /\ server' =
         [server EXCEPT
            !.owner[u] = a,
            !.alive = @ \cup {a},
            !.revision[a] = 1,
            !.fp[a] = fp]
    /\ dev' =
         [dev EXCEPT
            ![d].active = a,
            ![d].auth = a,
            ![d].authUsable = TRUE,
            ![d].present = @ \cup {a},
            ![d].local[a] = fp,
            ![d].baseRev[a] = 1,
            ![d].baseFp[a] = fp,
            ![d].lastAuto[a] = BlockEpoch(fp),
            ![d].sync = "CLEAN",
            ![d].switch = "IDLE"]
    /\ UNCHANGED <<backup, ordinaryWriteSafe, blockFreezeSafe>>

LoginAbsent(d, u) ==
  LET a == server.owner[u] IN
    /\ dev[d].up
    /\ dev[d].online
    /\ dev[d].active = Anon
    /\ a \in server.alive
    /\ a \notin dev[d].present
    /\ dev' =
         [dev EXCEPT
            ![d].active = a,
            ![d].auth = a,
            ![d].authUsable = TRUE,
            ![d].present = @ \cup {a},
            ![d].local[a] = CloudFp(a),
            ![d].baseRev[a] = server.revision[a],
            ![d].baseFp[a] = CloudFp(a),
            ![d].lastAuto[a] = BlockEpoch(CloudFp(a)),
            ![d].sync = "CLEAN",
            ![d].switch = "IDLE"]
    /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

LoginSame(d, u) ==
  LET a == server.owner[u] IN
    /\ dev[d].up
    /\ dev[d].online
    /\ dev[d].active = Anon
    /\ a \in server.alive
    /\ a \in dev[d].present
    /\ LocalFp(d, a) = CloudFp(a)
    /\ dev' =
         [dev EXCEPT
            ![d].active = a,
            ![d].auth = a,
            ![d].authUsable = TRUE,
            ![d].baseRev[a] = server.revision[a],
            ![d].baseFp[a] = CloudFp(a),
            ![d].sync = "CLEAN",
            ![d].switch = "IDLE"]
    /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

LoginPull(d, u) ==
  LET a == server.owner[u] IN
    /\ dev[d].up
    /\ dev[d].online
    /\ dev[d].active = Anon
    /\ a \in server.alive
    /\ a \in dev[d].present
    /\ LocalFp(d, a) # CloudFp(a)
    /\ LocalFp(d, a) = BaseFp(d, a)
    /\ RemoteChanged(d, a)
    /\ dev' =
         [dev EXCEPT
            ![d].active = a,
            ![d].auth = a,
            ![d].authUsable = TRUE,
            ![d].local[a] = CloudFp(a),
            ![d].baseRev[a] = server.revision[a],
            ![d].baseFp[a] = CloudFp(a),
            ![d].lastAuto[a] = BlockEpoch(CloudFp(a)),
            ![d].sync = "CLEAN",
            ![d].switch = "IDLE"]
    /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

LoginPush(d, u) ==
  LET a == server.owner[u] IN
    /\ dev[d].up
    /\ dev[d].online
    /\ dev[d].active = Anon
    /\ a \in server.alive
    /\ a \in dev[d].present
    /\ LocalDirty(d, a)
    /\ LocalFp(d, a) # CloudFp(a)
    /\ PushAllowed(d, a)
    /\ server.revision[a] < MaxRevision
    /\ server' =
         [server EXCEPT
            !.revision[a] = @ + 1,
            !.fp[a] = LocalFp(d, a)]
    /\ dev' =
         [dev EXCEPT
            ![d].active = a,
            ![d].auth = a,
            ![d].authUsable = TRUE,
            ![d].baseRev[a] = server.revision[a] + 1,
            ![d].baseFp[a] = LocalFp(d, a),
            ![d].sync = "CLEAN",
            ![d].switch = "IDLE"]
    /\ ordinaryWriteSafe' =
         ordinaryWriteSafe /\
         (server.revision[a] = dev[d].baseRev[a])
    /\ UNCHANGED <<backup, blockFreezeSafe>>

LoginConflict(d, u) ==
  LET a == server.owner[u] IN
    /\ dev[d].up
    /\ dev[d].online
    /\ dev[d].active = Anon
    /\ a \in server.alive
    /\ a \in dev[d].present
    /\ LocalFp(d, a) # CloudFp(a)
    /\ LocalDirty(d, a)
    /\ RemoteChanged(d, a)
    /\ dev' =
         [dev EXCEPT
            ![d].active = a,
            ![d].auth = a,
            ![d].authUsable = TRUE,
            ![d].sync = "CONFLICT",
            ![d].switch = "IDLE"]
    /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

BeginLogout(d) ==
  /\ dev[d].up
  /\ dev[d].active \in AccountIds
  /\ dev[d].switch = "IDLE"
  /\ dev' = [dev EXCEPT ![d].switch = "LOGOUT_PENDING"]
  /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

CommitLogoutClean(d) ==
  LET a == dev[d].active IN
    /\ a \in AccountIds
    /\ dev[d].switch = "LOGOUT_PENDING"
    /\ LocalFp(d, a) = CloudFp(a)
    /\ dev[d].baseRev[a] = server.revision[a]
    /\ dev' =
         [dev EXCEPT
            ![d].active = Anon,
            ![d].auth = None,
            ![d].authUsable = FALSE,
            ![d].sync = "CLEAN",
            ![d].switch = "IDLE"]
    /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

CommitLogoutAnyway(d) ==
  /\ dev[d].active \in AccountIds
  /\ dev[d].switch = "LOGOUT_PENDING"
  /\ dev' =
       [dev EXCEPT
          ![d].active = Anon,
          ![d].auth = None,
          ![d].authUsable = FALSE,
          ![d].sync = "CLEAN",
          ![d].switch = "IDLE"]
  /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

ChangeSetting(d) ==
  LET w == dev[d].active IN
    LET fp == LocalFp(d, w) IN
      /\ dev[d].up
      /\ SettingVersion(fp) < MaxSettingVersion
      /\ dev' =
           [dev EXCEPT
              ![d].local[w] = ChangeSettingFp(fp),
              ![d].sync =
                IF w \in AccountIds THEN "LOCAL_DIRTY" ELSE @]
      /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

ChangeBlockSize(d, n) ==
  LET w == dev[d].active IN
    LET fp == LocalFp(d, w) IN
      /\ dev[d].up
      /\ n \in 1..MaxBlockSize
      /\ n # BlockSizeSetting(fp)
      /\ (BlockChangePolicy # "retarget-current" \/ BlockProgress(fp) < n)
      /\ dev' =
           [dev EXCEPT
              ![d].local[w] = ChangeBlockSizeFp(fp, n),
              ![d].sync =
                IF w \in AccountIds THEN "LOCAL_DIRTY" ELSE @]
      /\ blockFreezeSafe' =
           IF BlockChangePolicy = "retarget-current" /\
              n # BlockTarget(fp)
           THEN FALSE
           ELSE blockFreezeSafe
      /\ UNCHANGED <<server, backup, ordinaryWriteSafe>>

CompleteWord(d) ==
  LET w == dev[d].active IN
    LET fp == LocalFp(d, w) IN
      /\ dev[d].up
      /\ (w = Anon \/ w \in dev[d].present)
      /\ Words(fp) < MaxWords
      /\ (~CompletesBlock(fp) \/ BlockEpoch(fp) < MaxBlockEpoch)
      /\ dev' =
           [dev EXCEPT
              ![d].local[w] = CompleteWordFp(fp),
              ![d].sync =
                IF w \in AccountIds THEN "LOCAL_DIRTY" ELSE @]
      /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

DeleteLearningRecords(d) ==
  LET w == dev[d].active IN
    LET fp == LocalFp(d, w) IN
      /\ dev[d].up
      /\ (w = Anon \/ w \in dev[d].present)
      /\ dev' =
           [dev EXCEPT
              ![d].local[w] = ResetLearningFp(fp),
              ![d].sync =
                IF w \in AccountIds THEN "LOCAL_DIRTY" ELSE @]
      /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

ManualNoop(d) ==
  LET a == dev[d].active IN
    /\ a \in AccountIds
    /\ CanUseAccount(d, a)
    /\ LocalFp(d, a) = CloudFp(a)
    /\ dev' =
         [dev EXCEPT
            ![d].baseRev[a] = server.revision[a],
            ![d].baseFp[a] = CloudFp(a),
            ![d].sync = "CLEAN"]
    /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

ManualPush(d) ==
  LET a == dev[d].active IN
    /\ a \in AccountIds
    /\ CanUseAccount(d, a)
    /\ LocalDirty(d, a)
    /\ LocalFp(d, a) # CloudFp(a)
    /\ PushAllowed(d, a)
    /\ server.revision[a] < MaxRevision
    /\ server' =
         [server EXCEPT
            !.revision[a] = @ + 1,
            !.fp[a] = LocalFp(d, a)]
    /\ dev' =
         [dev EXCEPT
            ![d].baseRev[a] = server.revision[a] + 1,
            ![d].baseFp[a] = LocalFp(d, a),
            ![d].sync = "CLEAN"]
    /\ ordinaryWriteSafe' =
         ordinaryWriteSafe /\
         (server.revision[a] = dev[d].baseRev[a])
    /\ UNCHANGED <<backup, blockFreezeSafe>>

ManualPull(d) ==
  LET a == dev[d].active IN
    /\ a \in AccountIds
    /\ CanUseAccount(d, a)
    /\ LocalFp(d, a) = BaseFp(d, a)
    /\ RemoteChanged(d, a)
    /\ LocalFp(d, a) # CloudFp(a)
    /\ dev' =
         [dev EXCEPT
            ![d].local[a] = CloudFp(a),
            ![d].baseRev[a] = server.revision[a],
            ![d].baseFp[a] = CloudFp(a),
            ![d].lastAuto[a] = BlockEpoch(CloudFp(a)),
            ![d].sync = "CLEAN"]
    /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

ManualConflict(d) ==
  LET a == dev[d].active IN
    /\ a \in AccountIds
    /\ CanUseAccount(d, a)
    /\ LocalFp(d, a) # CloudFp(a)
    /\ LocalDirty(d, a)
    /\ RemoteChanged(d, a)
    /\ dev' = [dev EXCEPT ![d].sync = "CONFLICT"]
    /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

AutoNoop(d) ==
  LET a == dev[d].active IN
    /\ a \in AccountIds
    /\ CanUseAccount(d, a)
    /\ BlockEpoch(LocalFp(d, a)) > dev[d].lastAuto[a]
    /\ LocalFp(d, a) = CloudFp(a)
    /\ dev' =
         [dev EXCEPT
            ![d].baseRev[a] = server.revision[a],
            ![d].baseFp[a] = CloudFp(a),
            ![d].lastAuto[a] = BlockEpoch(LocalFp(d, a)),
            ![d].sync = "CLEAN"]
    /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

AutoPush(d) ==
  LET a == dev[d].active IN
    /\ a \in AccountIds
    /\ CanUseAccount(d, a)
    /\ BlockEpoch(LocalFp(d, a)) > dev[d].lastAuto[a]
    /\ LocalDirty(d, a)
    /\ LocalFp(d, a) # CloudFp(a)
    /\ PushAllowed(d, a)
    /\ server.revision[a] < MaxRevision
    /\ server' =
         [server EXCEPT
            !.revision[a] = @ + 1,
            !.fp[a] = LocalFp(d, a)]
    /\ dev' =
         [dev EXCEPT
            ![d].baseRev[a] = server.revision[a] + 1,
            ![d].baseFp[a] = LocalFp(d, a),
            ![d].lastAuto[a] = BlockEpoch(LocalFp(d, a)),
            ![d].sync = "CLEAN"]
    /\ ordinaryWriteSafe' =
         ordinaryWriteSafe /\
         (server.revision[a] = dev[d].baseRev[a])
    /\ UNCHANGED <<backup, blockFreezeSafe>>

AutoRemoteAhead(d) ==
  LET a == dev[d].active IN
    /\ a \in AccountIds
    /\ CanUseAccount(d, a)
    /\ BlockEpoch(LocalFp(d, a)) > dev[d].lastAuto[a]
    /\ LocalFp(d, a) = BaseFp(d, a)
    /\ RemoteChanged(d, a)
    /\ dev' = [dev EXCEPT ![d].sync = "REMOTE_AHEAD"]
    /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

AutoConflict(d) ==
  LET a == dev[d].active IN
    /\ a \in AccountIds
    /\ CanUseAccount(d, a)
    /\ BlockEpoch(LocalFp(d, a)) > dev[d].lastAuto[a]
    /\ LocalDirty(d, a)
    /\ RemoteChanged(d, a)
    /\ LocalFp(d, a) # CloudFp(a)
    /\ dev' = [dev EXCEPT ![d].sync = "CONFLICT"]
    /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

(*
  Crash window: the server has accepted a safe push but the client has not yet
  durably advanced its baseline. A later metadata/no-op reconciliation must be
  able to heal this state.
*)
PushCommittedBeforeBaseline(d) ==
  LET a == dev[d].active IN
    /\ a \in AccountIds
    /\ CanUseAccount(d, a)
    /\ LocalDirty(d, a)
    /\ LocalFp(d, a) # CloudFp(a)
    /\ server.revision[a] = dev[d].baseRev[a]
    /\ server.revision[a] < MaxRevision
    /\ server' =
         [server EXCEPT
            !.revision[a] = @ + 1,
            !.fp[a] = LocalFp(d, a)]
    /\ dev' = [dev EXCEPT ![d].sync = "SYNCING"]
    /\ ordinaryWriteSafe' = ordinaryWriteSafe
    /\ UNCHANGED <<backup, blockFreezeSafe>>

(*
  Symmetric pull crash window: cloud content was applied locally before the
  baseline update was durably recorded.
*)
PullAppliedBeforeBaseline(d) ==
  LET a == dev[d].active IN
    /\ a \in AccountIds
    /\ CanUseAccount(d, a)
    /\ LocalFp(d, a) = BaseFp(d, a)
    /\ RemoteChanged(d, a)
    /\ LocalFp(d, a) # CloudFp(a)
    /\ dev' =
         [dev EXCEPT
            ![d].local[a] = CloudFp(a),
            ![d].sync = "SYNCING"]
    /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

ExplicitOverwriteCloud(d) ==
  LET a == dev[d].active IN
    /\ a \in AccountIds
    /\ CanUseAccount(d, a)
    /\ dev[d].sync = "CONFLICT"
    /\ server.revision[a] < MaxRevision
    /\ server' =
         [server EXCEPT
            !.revision[a] = @ + 1,
            !.fp[a] = LocalFp(d, a)]
    /\ dev' =
         [dev EXCEPT
            ![d].baseRev[a] = server.revision[a] + 1,
            ![d].baseFp[a] = LocalFp(d, a),
            ![d].sync = "CLEAN"]
    /\ UNCHANGED <<backup, ordinaryWriteSafe, blockFreezeSafe>>

ExplicitOverwriteLocal(d) ==
  LET a == dev[d].active IN
    /\ a \in AccountIds
    /\ CanUseAccount(d, a)
    /\ dev[d].sync = "CONFLICT"
    /\ dev' =
         [dev EXCEPT
            ![d].local[a] = CloudFp(a),
            ![d].baseRev[a] = server.revision[a],
            ![d].baseFp[a] = CloudFp(a),
            ![d].lastAuto[a] = BlockEpoch(CloudFp(a)),
            ![d].sync = "CLEAN"]
    /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

ExportBackup(d) ==
  LET w == dev[d].active IN
    /\ dev[d].up
    /\ (w = Anon \/ w \in dev[d].present)
    /\ backup' =
         [backup EXCEPT
            ![d].present = TRUE,
            ![d].owner = w,
            ![d].fp = LocalFp(d, w),
            ![d].importAuthorized = FALSE]
    /\ UNCHANGED <<server, dev, ordinaryWriteSafe, blockFreezeSafe>>

AuthorizeCrossImport(d) ==
  /\ backup[d].present
  /\ backup[d].owner # dev[d].active
  /\ backup' =
       [backup EXCEPT ![d].importAuthorized = TRUE]
  /\ UNCHANGED <<server, dev, ordinaryWriteSafe, blockFreezeSafe>>

RestoreSameWorkspaceBackup(d) ==
  LET w == dev[d].active IN
    /\ dev[d].up
    /\ backup[d].present
    /\ backup[d].owner = w
    /\ (w = Anon \/ w \in dev[d].present)
    /\ dev' =
         [dev EXCEPT
            ![d].local[w] = backup[d].fp,
            ![d].sync =
              IF w \in AccountIds
              THEN AssessmentFor(d, w, backup[d].fp)
              ELSE "CLEAN",
            ![d].lastAuto =
              IF w \in AccountIds
              THEN [@ EXCEPT ![w] = 0]
              ELSE @]
    /\ backup' =
         [backup EXCEPT ![d].importAuthorized = FALSE]
    /\ UNCHANGED <<server, ordinaryWriteSafe, blockFreezeSafe>>

RestoreAuthorizedForeignBackup(d) ==
  LET w == dev[d].active IN
    /\ dev[d].up
    /\ backup[d].present
    /\ backup[d].owner # w
    /\ backup[d].importAuthorized
    /\ (w = Anon \/ w \in dev[d].present)
    /\ dev' =
         [dev EXCEPT
            ![d].local[w] = backup[d].fp,
            ![d].sync =
              IF w \in AccountIds
              THEN AssessmentFor(d, w, backup[d].fp)
              ELSE "CLEAN",
            ![d].lastAuto =
              IF w \in AccountIds
              THEN [@ EXCEPT ![w] = 0]
              ELSE @]
    /\ backup' =
         [backup EXCEPT ![d].importAuthorized = FALSE]
    /\ UNCHANGED <<server, ordinaryWriteSafe, blockFreezeSafe>>

DeleteAccount(d) ==
  LET a == dev[d].active IN
    /\ a \in AccountIds
    /\ CanUseAccount(d, a)
    /\ server' =
         [server EXCEPT
            !.owner =
              [u \in Usernames |->
                IF server.owner[u] = a THEN None ELSE server.owner[u]],
            !.alive = @ \ {a},
            !.tombstones = @ \cup {a},
            !.revision[a] = 0,
            !.fp[a] = DefaultFp]
    /\ dev' =
         [dev EXCEPT
            ![d].present = @ \ {a},
            ![d].local[a] = DefaultFp,
            ![d].baseRev[a] = 0,
            ![d].baseFp[a] = DefaultFp,
            ![d].lastAuto[a] = 0,
            ![d].active = Anon,
            ![d].auth = None,
            ![d].authUsable = FALSE,
            ![d].sync = "ACCOUNT_DELETED",
            ![d].switch = "IDLE"]
    /\ UNCHANGED <<backup, ordinaryWriteSafe, blockFreezeSafe>>

ObserveDeletedAccount(d, a) ==
  /\ dev[d].up
  /\ dev[d].online
  /\ a \in server.tombstones
  /\ a \in dev[d].present
  /\ dev' =
       [dev EXCEPT
          ![d].present = @ \ {a},
          ![d].local[a] = DefaultFp,
          ![d].baseRev[a] = 0,
          ![d].baseFp[a] = DefaultFp,
          ![d].lastAuto[a] = 0,
          ![d].active =
            IF dev[d].active = a THEN Anon ELSE @,
          ![d].auth =
            IF dev[d].auth = a THEN None ELSE @,
          ![d].authUsable =
            IF dev[d].auth = a THEN FALSE ELSE @,
          ![d].sync =
            IF dev[d].active = a THEN "ACCOUNT_DELETED" ELSE @,
          ![d].switch =
            IF dev[d].active = a THEN "IDLE" ELSE @]
  /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

GoOffline(d) ==
  /\ dev[d].up
  /\ dev[d].online
  /\ dev' =
       [dev EXCEPT
          ![d].online = FALSE,
          ![d].sync =
            IF dev[d].active \in AccountIds THEN "OFFLINE" ELSE @]
  /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

GoOnline(d) ==
  LET w == dev[d].active IN
    /\ dev[d].up
    /\ ~dev[d].online
    /\ dev' =
         [dev EXCEPT
            ![d].online = TRUE,
            ![d].sync =
              IF w = Anon
              THEN "CLEAN"
              ELSE IF w \in server.tombstones
                   THEN "ACCOUNT_DELETED"
                   ELSE IF ~dev[d].authUsable
                        THEN "AUTH_REQUIRED"
                        ELSE Assessment(d, w)]
    /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

ExpireAuthentication(d) ==
  /\ dev[d].up
  /\ dev[d].active \in AccountIds
  /\ dev[d].auth = dev[d].active
  /\ dev[d].authUsable
  /\ dev' =
       [dev EXCEPT
          ![d].authUsable = FALSE,
          ![d].sync = "AUTH_REQUIRED"]
  /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

Reauthenticate(d) ==
  LET a == dev[d].active IN
    /\ a \in AccountIds
    /\ dev[d].up
    /\ dev[d].online
    /\ dev[d].auth = a
    /\ ~dev[d].authUsable
    /\ a \in server.alive
    /\ dev' =
         [dev EXCEPT
            ![d].authUsable = TRUE,
            ![d].sync = Assessment(d, a)]
    /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

Crash(d) ==
  /\ dev[d].up
  /\ dev' = [dev EXCEPT ![d].up = FALSE]
  /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

Restart(d) ==
  LET w == dev[d].active IN
    /\ ~dev[d].up
    /\ dev' =
         [dev EXCEPT
            ![d].up = TRUE,
            ![d].sync =
              IF w = Anon
              THEN "CLEAN"
              ELSE IF w \in server.tombstones
                   THEN "ACCOUNT_DELETED"
                   ELSE IF ~dev[d].online
                        THEN "OFFLINE"
                        ELSE IF ~dev[d].authUsable
                             THEN "AUTH_REQUIRED"
                             ELSE Assessment(d, w)]
  /\ UNCHANGED <<server, backup, ordinaryWriteSafe, blockFreezeSafe>>

RegistrationActions ==
  \/ \E d \in Devices, u \in Usernames, a \in AccountIds :
       RegisterBlank(d, u, a)
  \/ \E d \in Devices, u \in Usernames, a \in AccountIds :
       RegisterCopyAnonymous(d, u, a)

LoginActions ==
  \/ \E d \in Devices, u \in Usernames : LoginAbsent(d, u)
  \/ \E d \in Devices, u \in Usernames : LoginSame(d, u)
  \/ \E d \in Devices, u \in Usernames : LoginPull(d, u)
  \/ \E d \in Devices, u \in Usernames : LoginPush(d, u)
  \/ \E d \in Devices, u \in Usernames : LoginConflict(d, u)

LogoutActions ==
  \/ \E d \in Devices : BeginLogout(d)
  \/ \E d \in Devices : CommitLogoutClean(d)
  \/ \E d \in Devices : CommitLogoutAnyway(d)

LocalMutationActions ==
  \/ \E d \in Devices : ChangeSetting(d)
  \/ \E d \in Devices, n \in 1..MaxBlockSize : ChangeBlockSize(d, n)
  \/ \E d \in Devices : CompleteWord(d)
  \/ \E d \in Devices : DeleteLearningRecords(d)

SyncActions ==
  \/ \E d \in Devices : ManualNoop(d)
  \/ \E d \in Devices : ManualPush(d)
  \/ \E d \in Devices : ManualPull(d)
  \/ \E d \in Devices : ManualConflict(d)
  \/ \E d \in Devices : AutoNoop(d)
  \/ \E d \in Devices : AutoPush(d)
  \/ \E d \in Devices : AutoRemoteAhead(d)
  \/ \E d \in Devices : AutoConflict(d)
  \/ \E d \in Devices : PushCommittedBeforeBaseline(d)
  \/ \E d \in Devices : PullAppliedBeforeBaseline(d)
  \/ \E d \in Devices : ExplicitOverwriteCloud(d)
  \/ \E d \in Devices : ExplicitOverwriteLocal(d)

BackupActions ==
  \/ \E d \in Devices : ExportBackup(d)
  \/ \E d \in Devices : AuthorizeCrossImport(d)
  \/ \E d \in Devices : RestoreSameWorkspaceBackup(d)
  \/ \E d \in Devices : RestoreAuthorizedForeignBackup(d)

AccountDeletionActions ==
  \/ \E d \in Devices : DeleteAccount(d)
  \/ \E d \in Devices, a \in AccountIds : ObserveDeletedAccount(d, a)

FaultActions ==
  \/ \E d \in Devices : GoOffline(d)
  \/ \E d \in Devices : GoOnline(d)
  \/ \E d \in Devices : ExpireAuthentication(d)
  \/ \E d \in Devices : Reauthenticate(d)
  \/ \E d \in Devices : Crash(d)
  \/ \E d \in Devices : Restart(d)

(* Canonical complete protocol relation. Implementation refines this relation. *)
Next ==
  \/ RegistrationActions
  \/ LoginActions
  \/ LogoutActions
  \/ LocalMutationActions
  \/ SyncActions
  \/ BackupActions
  \/ AccountDeletionActions
  \/ FaultActions

(*
  Exhaustive TLC projections. These are subsets of the same canonical Next
  relation and exist only to control finite-state Cartesian explosion in CI.
*)
NextBlock ==
  \/ RegistrationActions
  \/ LoginActions
  \/ LogoutActions
  \/ LocalMutationActions
  \/ SyncActions
  \/ FaultActions

CompleteWordProjection ==
  \/ \E d \in Devices : CompleteWord(d)
  \/ \E d \in Devices : DeleteLearningRecords(d)

(* Intentional negative control: remove the ordinary-write base-revision
   CAS guard, while keeping all other ManualPush data/account/revision guards.
   The positive model's Next, ManualPush and Safety remain unchanged. *)
StalePushWithoutCAS(d) ==
  LET a == dev[d].active IN
    /\ a \in AccountIds
    /\ CanUseAccount(d, a)
    /\ LocalDirty(d, a)
    /\ LocalFp(d, a) # CloudFp(a)
    /\ RemoteChanged(d, a)
    /\ server.revision[a] < MaxRevision
    /\ server' =
         [server EXCEPT
            !.revision[a] = @ + 1,
            !.fp[a] = LocalFp(d, a)]
    /\ dev' =
         [dev EXCEPT
            ![d].baseRev[a] = server.revision[a] + 1,
            ![d].baseFp[a] = LocalFp(d, a),
            ![d].sync = "CLEAN"]
    /\ ordinaryWriteSafe' =
         ordinaryWriteSafe /\
         (server.revision[a] = dev[d].baseRev[a])
    /\ UNCHANGED <<backup, blockFreezeSafe>>

(* Small independent subset to find the stale-device overwrite trace. *)
NextStalePushMutation ==
  \/ \E d \in Devices, u \in Usernames, a \in AccountIds :
       RegisterBlank(d, u, a)
  \/ \E d \in Devices, u \in Usernames : LoginAbsent(d, u)
  \/ \E d \in Devices : ChangeSetting(d)
  \/ \E d \in Devices : CompleteWord(d)
  \/ \E d \in Devices : ManualPush(d)
  \/ \E d \in Devices : StalePushWithoutCAS(d)

NextConcurrent ==
  \/ RegistrationActions
  \/ LoginActions
  \/ LogoutActions
  \/ CompleteWordProjection
  \/ SyncActions
  \/ AccountDeletionActions
  \/ FaultActions

NextIdentity ==
  \/ RegistrationActions
  \/ LoginActions
  \/ LogoutActions
  \/ AccountDeletionActions
  \/ FaultActions

NextBackup ==
  \/ RegistrationActions
  \/ LoginActions
  \/ LogoutActions
  \/ CompleteWordProjection
  \/ SyncActions
  \/ BackupActions
  \/ FaultActions

NextScale ==
  \/ RegistrationActions
  \/ LoginActions
  \/ LogoutActions
  \/ CompleteWordProjection
  \/ SyncActions
  \/ AccountDeletionActions
  \/ FaultActions

Spec ==
  Init /\ [][Next]_vars

====
