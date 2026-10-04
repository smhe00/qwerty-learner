---- MODULE ProgressSemantics ----
EXTENDS Naturals

CONSTANT ProgressPolicy

VARIABLES
  phase,
  success,
  beforeIndex,
  afterIndex,
  beforeItemVersion,
  afterItemVersion,
  finished

vars ==
  << phase,
     success,
     beforeIndex,
     afterIndex,
     beforeItemVersion,
     afterItemVersion,
     finished >>

Init ==
  /\ phase = "active"
  /\ success = FALSE
  /\ beforeIndex = 0
  /\ afterIndex = 0
  /\ beforeItemVersion = 0
  /\ afterItemVersion = 0
  /\ finished = FALSE

ApplyAdvance ==
  /\ phase = "active"
  /\ phase' = "resolved"
  /\ success' = TRUE
  /\ afterIndex' = beforeIndex + 1
  /\ afterItemVersion' = beforeItemVersion
  /\ finished' = FALSE
  /\ UNCHANGED << beforeIndex, beforeItemVersion >>

ApplyRetry ==
  /\ phase = "active"
  /\ phase' = "resolved"
  /\ success' = TRUE
  /\ afterIndex' = beforeIndex
  /\ afterItemVersion' = beforeItemVersion + 1
  /\ finished' = FALSE
  /\ UNCHANGED << beforeIndex, beforeItemVersion >>

ApplyFinish ==
  /\ phase = "active"
  /\ phase' = "resolved"
  /\ success' = TRUE
  /\ afterIndex' = beforeIndex
  /\ afterItemVersion' = beforeItemVersion
  /\ finished' = TRUE
  /\ UNCHANGED << beforeIndex, beforeItemVersion >>

ApplySilentNoop ==
  /\ phase = "active"
  /\ ProgressPolicy = "silent-noop"
  /\ phase' = "resolved"
  /\ success' = TRUE
  /\ afterIndex' = beforeIndex
  /\ afterItemVersion' = beforeItemVersion
  /\ finished' = FALSE
  /\ UNCHANGED << beforeIndex, beforeItemVersion >>

StayResolved ==
  /\ phase = "resolved"
  /\ UNCHANGED vars

Next ==
  \/ ApplyAdvance
  \/ ApplyRetry
  \/ ApplyFinish
  \/ ApplySilentNoop
  \/ StayResolved

SuccessfulAttemptHasEffect ==
  success =>
    \/ afterIndex # beforeIndex
    \/ afterItemVersion # beforeItemVersion
    \/ finished

Spec ==
  Init /\ [][Next]_vars

====
