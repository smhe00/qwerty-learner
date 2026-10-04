---- MODULE DuePriority ----
EXTENDS Naturals

CONSTANT PriorityPolicy

VARIABLES
  phase,
  due,
  pendingReady,
  unseen,
  quota,
  sessionSize,
  acquisitionKind

vars ==
  << phase,
     due,
     pendingReady,
     unseen,
     quota,
     sessionSize,
     acquisitionKind >>

Init ==
  /\ phase = "idle"
  /\ due \in 0..2
  /\ pendingReady \in 0..1
  /\ unseen \in 0..2
  /\ quota \in 0..2
  /\ sessionSize = 0
  /\ acquisitionKind = "none"

StartReview ==
  /\ phase = "idle"
  /\ due > 0
  /\ phase' = "review"
  /\ sessionSize' = due
  /\ acquisitionKind' = "none"
  /\ UNCHANGED << due, pendingReady, unseen, quota >>

StartPendingAcquisition ==
  /\ phase = "idle"
  /\ pendingReady > 0
  /\ (PriorityPolicy = "bypass-due" \/ due = 0)
  /\ phase' = "acquisition"
  /\ sessionSize' = pendingReady
  /\ acquisitionKind' = "pending"
  /\ UNCHANGED << due, pendingReady, unseen, quota >>

StartFreshAcquisition ==
  /\ phase = "idle"
  /\ unseen > 0
  /\ quota > 0
  /\ (PriorityPolicy = "bypass-due" \/ due = 0)
  /\ phase' = "acquisition"
  /\ sessionSize' =
       IF unseen <= quota THEN unseen ELSE quota
  /\ acquisitionKind' = "fresh"
  /\ UNCHANGED << due, pendingReady, unseen, quota >>

StaySelected ==
  /\ phase # "idle"
  /\ UNCHANGED vars

Next ==
  \/ StartReview
  \/ StartPendingAcquisition
  \/ StartFreshAcquisition
  \/ StaySelected

NoAcquisitionWhenDue ==
  ~(phase = "acquisition" /\ due > 0)

Spec ==
  Init /\ [][Next]_vars

====
