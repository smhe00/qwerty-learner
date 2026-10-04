---- MODULE SessionArbitration ----
EXTENDS Naturals

CONSTANT ArbitrationPolicy

VARIABLES
  phase,
  recoverableCount,
  newerFinished,
  expectedSession,
  decision,
  selectedSession,
  selectedDictMatches,
  selectedFinished,
  selectedCount

vars ==
  << phase,
     recoverableCount,
     newerFinished,
     expectedSession,
     decision,
     selectedSession,
     selectedDictMatches,
     selectedFinished,
     selectedCount >>

Init ==
  /\ phase = "idle"
  /\ recoverableCount \in 0..2
  /\ newerFinished \in BOOLEAN
  /\ expectedSession = recoverableCount
  /\ decision = "none"
  /\ selectedSession = 0
  /\ selectedDictMatches = TRUE
  /\ selectedFinished = FALSE
  /\ selectedCount = 0

RestoreLatest ==
  /\ phase = "idle"
  /\ recoverableCount > 0
  /\ phase' = "decided"
  /\ decision' = "restore"
  /\ selectedSession' = expectedSession
  /\ selectedDictMatches' = TRUE
  /\ selectedFinished' = FALSE
  /\ selectedCount' = 1
  /\ UNCHANGED
       << recoverableCount,
          newerFinished,
          expectedSession >>

CreateNew ==
  /\ phase = "idle"
  /\ recoverableCount = 0
  /\ phase' = "decided"
  /\ decision' = "new"
  /\ selectedSession' = 0
  /\ selectedDictMatches' = TRUE
  /\ selectedFinished' = FALSE
  /\ selectedCount' = 0
  /\ UNCHANGED
       << recoverableCount,
          newerFinished,
          expectedSession >>

Wait ==
  /\ phase = "idle"
  /\ recoverableCount = 0
  /\ phase' = "decided"
  /\ decision' = "waiting"
  /\ selectedSession' = 0
  /\ selectedDictMatches' = TRUE
  /\ selectedFinished' = FALSE
  /\ selectedCount' = 0
  /\ UNCHANGED
       << recoverableCount,
          newerFinished,
          expectedSession >>

MutateFinishedShadowsUnfinished ==
  /\ ArbitrationPolicy = "finished-shadows-unfinished"
  /\ phase = "idle"
  /\ recoverableCount > 0
  /\ newerFinished
  /\ phase' = "decided"
  /\ decision' = "new"
  /\ selectedSession' = 0
  /\ selectedDictMatches' = TRUE
  /\ selectedFinished' = FALSE
  /\ selectedCount' = 0
  /\ UNCHANGED
       << recoverableCount,
          newerFinished,
          expectedSession >>

MutateOldestUnfinished ==
  /\ ArbitrationPolicy = "oldest-unfinished"
  /\ phase = "idle"
  /\ recoverableCount = 2
  /\ phase' = "decided"
  /\ decision' = "restore"
  /\ selectedSession' = 1
  /\ selectedDictMatches' = TRUE
  /\ selectedFinished' = FALSE
  /\ selectedCount' = 1
  /\ UNCHANGED
       << recoverableCount,
          newerFinished,
          expectedSession >>

MutateWrongDict ==
  /\ ArbitrationPolicy = "wrong-dict"
  /\ phase = "idle"
  /\ recoverableCount > 0
  /\ phase' = "decided"
  /\ decision' = "restore"
  /\ selectedSession' = expectedSession
  /\ selectedDictMatches' = FALSE
  /\ selectedFinished' = FALSE
  /\ selectedCount' = 1
  /\ UNCHANGED
       << recoverableCount,
          newerFinished,
          expectedSession >>

MutateWaitingDespiteUnfinished ==
  /\ ArbitrationPolicy = "waiting-despite-unfinished"
  /\ phase = "idle"
  /\ recoverableCount > 0
  /\ phase' = "decided"
  /\ decision' = "waiting"
  /\ selectedSession' = 0
  /\ selectedDictMatches' = TRUE
  /\ selectedFinished' = FALSE
  /\ selectedCount' = 0
  /\ UNCHANGED
       << recoverableCount,
          newerFinished,
          expectedSession >>

StayDecided ==
  /\ phase = "decided"
  /\ UNCHANGED vars

Next ==
  \/ RestoreLatest
  \/ CreateNew
  \/ Wait
  \/ MutateFinishedShadowsUnfinished
  \/ MutateOldestUnfinished
  \/ MutateWrongDict
  \/ MutateWaitingDespiteUnfinished
  \/ StayDecided

SessionArbitrationSound ==
  phase # "decided"
  \/
    IF recoverableCount > 0
    THEN
      /\ decision = "restore"
      /\ selectedSession = expectedSession
      /\ selectedDictMatches
      /\ ~selectedFinished
      /\ selectedCount = 1
    ELSE
      /\ decision # "restore"
      /\ selectedCount = 0

Spec ==
  Init /\ [][Next]_vars

====
