---- MODULE ProjectionConsistency ----
EXTENDS Naturals

CONSTANT ProjectionPolicy

VARIABLES
  phase,
  success,
  beforeIndex,
  actualIndex,
  expectedIndex,
  actualQueueVersion,
  expectedQueueVersion,
  actualFinished,
  expectedFinished,
  beforeItemVersion,
  afterItemVersion

vars ==
  << phase,
     success,
     beforeIndex,
     actualIndex,
     expectedIndex,
     actualQueueVersion,
     expectedQueueVersion,
     actualFinished,
     expectedFinished,
     beforeItemVersion,
     afterItemVersion >>

Init ==
  /\ phase = "active"
  /\ success = FALSE
  /\ beforeIndex = 0
  /\ actualIndex = 0
  /\ expectedIndex = 0
  /\ actualQueueVersion = 0
  /\ expectedQueueVersion = 0
  /\ actualFinished = FALSE
  /\ expectedFinished = FALSE
  /\ beforeItemVersion = 0
  /\ afterItemVersion = 0

ResolveExpectedAdvance ==
  /\ phase = "active"
  /\ phase' = "resolved"
  /\ success' = TRUE
  /\ expectedIndex' = 1
  /\ expectedQueueVersion' = 1
  /\ expectedFinished' = FALSE
  /\ afterItemVersion' = 1
  /\ actualIndex' =
       IF ProjectionPolicy = "production" THEN 1 ELSE 0
  /\ actualQueueVersion' =
       IF ProjectionPolicy = "production" THEN 1 ELSE 0
  /\ actualFinished' = FALSE
  /\ UNCHANGED << beforeIndex, beforeItemVersion >>

ResolveExpectedFinish ==
  /\ phase = "active"
  /\ phase' = "resolved"
  /\ success' = TRUE
  /\ expectedIndex' = 0
  /\ expectedQueueVersion' = 1
  /\ expectedFinished' = TRUE
  /\ afterItemVersion' = 1
  /\ actualIndex' = 0
  /\ actualQueueVersion' =
       IF ProjectionPolicy = "production" THEN 1 ELSE 0
  /\ actualFinished' =
       IF ProjectionPolicy = "production" THEN TRUE ELSE FALSE
  /\ UNCHANGED << beforeIndex, beforeItemVersion >>

StayResolved ==
  /\ phase = "resolved"
  /\ UNCHANGED vars

Next ==
  \/ ResolveExpectedAdvance
  \/ ResolveExpectedFinish
  \/ StayResolved

ProjectionMatches ==
  phase = "resolved" =>
    /\ actualIndex = expectedIndex
    /\ actualQueueVersion = expectedQueueVersion
    /\ actualFinished = expectedFinished

Spec ==
  Init /\ [][Next]_vars

====
