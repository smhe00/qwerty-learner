---- MODULE CheckpointMonotonicity ----
EXTENDS Naturals

CONSTANT RestorePolicy

VARIABLES
  phase,
  durableVersion,
  durableFinished,
  staleVersion,
  staleFinished,
  restoredVersion,
  restoredFinished

vars ==
  << phase,
     durableVersion,
     durableFinished,
     staleVersion,
     staleFinished,
     restoredVersion,
     restoredFinished >>

Init ==
  /\ phase = "active"
  /\ durableVersion = 0
  /\ durableFinished = FALSE
  /\ staleVersion = 0
  /\ staleFinished = FALSE
  /\ restoredVersion = 0
  /\ restoredFinished = FALSE

SaveProgress ==
  /\ phase = "active"
  /\ durableVersion = 0
  /\ durableVersion' = 1
  /\ durableFinished' = FALSE
  /\ staleVersion' = durableVersion
  /\ staleFinished' = durableFinished
  /\ UNCHANGED
       << phase,
          restoredVersion,
          restoredFinished >>

SaveTerminal ==
  /\ phase = "active"
  /\ durableVersion = 1
  /\ durableVersion' = 2
  /\ durableFinished' = TRUE
  /\ staleVersion' = durableVersion
  /\ staleFinished' = durableFinished
  /\ UNCHANGED
       << phase,
          restoredVersion,
          restoredFinished >>

Refresh ==
  /\ phase = "active"
  /\ durableVersion > 0
  /\ phase' = "restored"
  /\ restoredVersion' =
       IF RestorePolicy = "production"
       THEN durableVersion
       ELSE staleVersion
  /\ restoredFinished' =
       IF RestorePolicy = "production"
       THEN durableFinished
       ELSE staleFinished
  /\ UNCHANGED
       << durableVersion,
          durableFinished,
          staleVersion,
          staleFinished >>

StayRestored ==
  /\ phase = "restored"
  /\ UNCHANGED vars

Next ==
  \/ SaveProgress
  \/ SaveTerminal
  \/ Refresh
  \/ StayRestored

RestoreLatestCheckpoint ==
  phase = "restored" =>
    /\ restoredVersion = durableVersion
    /\ (durableFinished => restoredFinished)

Spec ==
  Init /\ [][Next]_vars

====
