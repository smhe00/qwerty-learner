---- MODULE S2Recovery ----
EXTENDS Naturals

(*
  P4b-1: bounded refinement of the explicit S2 conflict/Pull transaction.
  Revision numbers abstract verified complete Backup V4 logical fingerprints.
  SHA/GZip validity is assumed at Stage, not proved by this abstraction.
  IndexedDB journal durability is modeled across Crash/Restart.
  S1's single-writer profile lock is assumed by the actions.
*)

CONSTANTS Devices, Accounts, MaxRev, UnsafeRecovery
ASSUME
  /\ Devices # {}
  /\ Accounts # {}
  /\ MaxRev >= 2
  /\ UnsafeRecovery \in BOOLEAN

NoOwner == "none"
ASSUME NoOwner \notin Accounts
FirstOwner == CHOOSE a \in Accounts : TRUE

VARIABLES cloud, client, writeSafe
vars == <<cloud, client, writeSafe>>

Init ==
  /\ cloud = [a \in Accounts |-> 1]
  /\ client = [d \in Devices |->
     [ owner    |-> FirstOwner,
       auth     |-> TRUE,
       online   |-> TRUE,
       up       |-> TRUE,
       base     |-> 0,
       local    |-> 0,
       saved    |-> FALSE,
       confirmed|-> FALSE,
       journal  |-> FALSE,
       stageRev |-> 0,
       stageOwner |-> NoOwner,
       mounted  |-> TRUE ]]
  /\ writeSafe = TRUE

BackupBoth(d) ==
  /\ client[d].up
  /\ ~client[d].saved
  /\ client' = [client EXCEPT ![d].saved = TRUE]
  /\ UNCHANGED <<cloud, writeSafe>>

ExplicitConsent(d) ==
  /\ client[d].up
  /\ client[d].saved
  /\ ~client[d].confirmed
  /\ client' = [client EXCEPT ![d].confirmed = TRUE]
  /\ UNCHANGED <<cloud, writeSafe>>

RemoteAdvance(a) ==
  /\ cloud[a] < MaxRev
  /\ cloud' = [cloud EXCEPT ![a] = @ + 1]
  /\ UNCHANGED <<client, writeSafe>>

StageVerifiedPull(d) ==
  LET a == client[d].owner IN
  /\ client[d].up
  /\ client[d].online
  /\ client[d].auth
  /\ client[d].saved
  /\ client[d].confirmed
  /\ ~client[d].journal
  /\ client[d].base < cloud[a]
  /\ client' = [client EXCEPT
       ![d].journal = TRUE,
       ![d].stageOwner = a,
       ![d].stageRev = cloud[a],
       ![d].mounted = FALSE]
  /\ UNCHANGED <<cloud, writeSafe>>

Crash(d) ==
  /\ client[d].up
  /\ client' = [client EXCEPT ![d].up = FALSE, ![d].mounted = FALSE]
  /\ UNCHANGED <<cloud, writeSafe>>

Restart(d) ==
  /\ ~client[d].up
  /\ client' = [client EXCEPT ![d].up = TRUE, ![d].mounted = FALSE]
  /\ UNCHANGED <<cloud, writeSafe>>

PartialRestore(d) ==
  /\ client[d].up
  /\ client[d].journal
  /\ client[d].local # client[d].stageRev
  /\ client' = [client EXCEPT ![d].local = client[d].stageRev]
  /\ UNCHANGED <<cloud, writeSafe>>

ReplayAndAtomicBaseline(d) ==
  /\ client[d].up
  /\ client[d].journal
  /\ client[d].owner = client[d].stageOwner
  /\ client' = [client EXCEPT
       ![d].local = client[d].stageRev,
       ![d].base = client[d].stageRev,
       ![d].journal = FALSE,
       ![d].stageOwner = NoOwner,
       ![d].stageRev = 0,
       ![d].saved = FALSE,
       ![d].confirmed = FALSE,
       ![d].mounted = FALSE]
  /\ UNCHANGED <<cloud, writeSafe>>

Mount(d) ==
  /\ client[d].up
  /\ client[d].auth
  /\ ~client[d].mounted
  /\ ~client[d].journal
  /\ client' = [client EXCEPT ![d].mounted = TRUE]
  /\ UNCHANGED <<cloud, writeSafe>>

SwitchAccount(d, a) ==
  /\ client[d].up
  /\ ~client[d].journal
  /\ client[d].owner # a
  /\ client' = [client EXCEPT
       ![d].owner = a,
       ![d].auth = FALSE,
       ![d].base = 0,
       ![d].local = 0,
       ![d].saved = FALSE,
       ![d].confirmed = FALSE,
       ![d].mounted = FALSE]
  /\ UNCHANGED <<cloud, writeSafe>>

Reauth(d) ==
  /\ client[d].up
  /\ ~client[d].auth
  /\ client' = [client EXCEPT ![d].auth = TRUE]
  /\ UNCHANGED <<cloud, writeSafe>>

Expire(d) ==
  /\ client[d].auth
  /\ client' = [client EXCEPT ![d].auth = FALSE]
  /\ UNCHANGED <<cloud, writeSafe>>

Offline(d) ==
  /\ client[d].online
  /\ client' = [client EXCEPT ![d].online = FALSE]
  /\ UNCHANGED <<cloud, writeSafe>>

Online(d) ==
  /\ ~client[d].online
  /\ client' = [client EXCEPT ![d].online = TRUE]
  /\ UNCHANGED <<cloud, writeSafe>>

ExplicitRecoveryCAS(d) ==
  LET a == client[d].owner IN
  /\ client[d].up
  /\ client[d].online
  /\ client[d].auth
  /\ client[d].saved
  /\ client[d].confirmed
  /\ ~client[d].journal
  /\ cloud[a] < MaxRev
  /\ client[d].base = cloud[a]
  /\ cloud' = [cloud EXCEPT ![a] = @ + 1]
  /\ client' = [client EXCEPT
       ![d].base = cloud[a] + 1,
       ![d].saved = FALSE,
       ![d].confirmed = FALSE]
  /\ UNCHANGED writeSafe

(* Negative-control model. A forged recovery request bypasses user consent. *)
UnsafeOverwrite(d) ==
  LET a == client[d].owner IN
  /\ UnsafeRecovery
  /\ client[d].up
  /\ client[d].online
  /\ client[d].auth
  /\ cloud[a] < MaxRev
  /\ cloud' = [cloud EXCEPT ![a] = @ + 1]
  /\ client' = [client EXCEPT ![d].base = cloud[a] + 1]
  /\ writeSafe' = FALSE

NextCore ==
  \/ \E d \in Devices : BackupBoth(d)
  \/ \E d \in Devices : ExplicitConsent(d)
  \/ \E a \in Accounts : RemoteAdvance(a)
  \/ \E d \in Devices : StageVerifiedPull(d)
  \/ \E d \in Devices : Crash(d)
  \/ \E d \in Devices : Restart(d)
  \/ \E d \in Devices : PartialRestore(d)
  \/ \E d \in Devices : ReplayAndAtomicBaseline(d)
  \/ \E d \in Devices : Mount(d)
  \/ \E d \in Devices, a \in Accounts : SwitchAccount(d, a)
  \/ \E d \in Devices : Reauth(d)
  \/ \E d \in Devices : Expire(d)
  \/ \E d \in Devices : Offline(d)
  \/ \E d \in Devices : Online(d)
  \/ \E d \in Devices : ExplicitRecoveryCAS(d)
  \/ \E d \in Devices : UnsafeOverwrite(d)

JournalOwnerSafe ==
  \A d \in Devices :
    client[d].journal => client[d].stageOwner = client[d].owner

NoMixedMountedReplica ==
  \A d \in Devices :
    client[d].journal => ~client[d].mounted

BaselineMonotonicWithCloud ==
  \A d \in Devices :
    client[d].base <= cloud[client[d].owner]

NoUnauthorizedCloudOverwrite == writeSafe

TypeOK ==
  /\ cloud \in [Accounts -> 1..MaxRev]
  /\ client \in [Devices ->
     [owner: Accounts, auth: BOOLEAN, online: BOOLEAN, up: BOOLEAN,
      base: 0..MaxRev, local: 0..MaxRev,
      saved: BOOLEAN, confirmed: BOOLEAN,
      journal: BOOLEAN, stageRev: 0..MaxRev,
      stageOwner: Accounts \cup {NoOwner}, mounted: BOOLEAN]]
  /\ writeSafe \in BOOLEAN

Safety ==
  /\ TypeOK
  /\ JournalOwnerSafe
  /\ NoMixedMountedReplica
  /\ BaselineMonotonicWithCloud
  /\ NoUnauthorizedCloudOverwrite

Spec == Init /\ [][NextCore]_vars

====
