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
  reviewSize,
  acquisitionSize,
  acquisitionKind

vars ==
  << phase,
     due,
     pendingReady,
     unseen,
     quota,
     sessionSize,
     reviewSize,
     acquisitionSize,
     acquisitionKind >>

AcquisitionAvailable ==
  pendingReady > 0 \/ (unseen > 0 /\ quota > 0)

FreshCount ==
  IF unseen <= quota THEN unseen ELSE quota

SelectedAcquisitionCount ==
  IF pendingReady > 0 THEN pendingReady ELSE FreshCount

Init ==
  /\ phase = "idle"
  /\ due \in 0..2
  /\ pendingReady \in 0..1
  /\ unseen \in 0..2
  /\ quota \in 0..2
  /\ sessionSize = 0
  /\ reviewSize = 0
  /\ acquisitionSize = 0
  /\ acquisitionKind = "none"

StartReview ==
  /\ phase = "idle"
  /\ due > 0
  /\ ~AcquisitionAvailable
  /\ phase' = "review"
  /\ sessionSize' = due
  /\ reviewSize' = due
  /\ acquisitionSize' = 0
  /\ acquisitionKind' = "none"
  /\ UNCHANGED << due, pendingReady, unseen, quota >>

StartMixed ==
  /\ phase = "idle"
  /\ due > 0
  /\ AcquisitionAvailable
  /\ PriorityPolicy # "bypass-due"
  /\ phase' = "mixed"
  /\ reviewSize' = due
  /\ acquisitionSize' = SelectedAcquisitionCount
  /\ sessionSize' = due + SelectedAcquisitionCount
  /\ acquisitionKind' =
       IF pendingReady > 0 THEN "pending" ELSE "fresh"
  /\ UNCHANGED << due, pendingReady, unseen, quota >>

StartPendingAcquisition ==
  /\ phase = "idle"
  /\ pendingReady > 0
  /\ (PriorityPolicy = "bypass-due" \/ due = 0)
  /\ phase' = "acquisition"
  /\ sessionSize' = pendingReady
  /\ reviewSize' = 0
  /\ acquisitionSize' = pendingReady
  /\ acquisitionKind' = "pending"
  /\ UNCHANGED << due, pendingReady, unseen, quota >>

StartFreshAcquisition ==
  /\ phase = "idle"
  /\ unseen > 0
  /\ quota > 0
  /\ pendingReady = 0
  /\ (PriorityPolicy = "bypass-due" \/ due = 0)
  /\ phase' = "acquisition"
  /\ acquisitionSize' = FreshCount
  /\ sessionSize' = FreshCount
  /\ reviewSize' = 0
  /\ acquisitionKind' = "fresh"
  /\ UNCHANGED << due, pendingReady, unseen, quota >>

StaySelected ==
  /\ phase # "idle"
  /\ UNCHANGED vars

Next ==
  \/ StartReview
  \/ StartMixed
  \/ StartPendingAcquisition
  \/ StartFreshAcquisition
  \/ StaySelected

NoPureAcquisitionWhenDue ==
  ~(phase = "acquisition" /\ due > 0)

MixedCarriesReview ==
  phase = "mixed" => reviewSize > 0

MixedCarriesAcquisition ==
  phase = "mixed" => acquisitionSize > 0

Spec ==
  Init /\ [][Next]_vars

====
