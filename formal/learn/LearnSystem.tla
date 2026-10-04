---- MODULE LearnSystem ----
EXTENDS Naturals

CONSTANTS
  Target,
  InitialIntroduced,
  InitialAcquired,
  InitialUnseen,
  QuotaAccounting

VARIABLES
  phase,
  introduced,
  acquired,
  unseen,
  pending,
  sessionSize,
  singletonRun

vars ==
  << phase,
     introduced,
     acquired,
     unseen,
     pending,
     sessionSize,
     singletonRun >>

Min(a, b) ==
  IF a <= b THEN a ELSE b

QuotaBase ==
  IF QuotaAccounting = "introduced"
  THEN introduced
  ELSE acquired

Remaining ==
  IF QuotaBase >= Target
  THEN 0
  ELSE Target - QuotaBase

Init ==
  /\ phase = "idle"
  /\ introduced = InitialIntroduced
  /\ acquired = InitialAcquired
  /\ unseen = InitialUnseen
  /\ pending = 0
  /\ sessionSize = 0
  /\ singletonRun = 0

StartAcquisition ==
  /\ phase = "idle"
  /\ Remaining > 0
  /\ unseen > 0
  /\ phase' = "acquisition"
  /\ sessionSize' = Min(Remaining, unseen)
  /\ singletonRun' =
       IF Min(Remaining, unseen) = 1 /\ unseen > 1
       THEN singletonRun + 1
       ELSE 0
  /\ UNCHANGED
       << introduced,
          acquired,
          unseen,
          pending >>

DeferAcquisition ==
  /\ phase = "acquisition"
  /\ phase' = "idle"
  /\ introduced' = introduced + sessionSize
  /\ acquired' = acquired
  /\ unseen' = unseen - sessionSize
  /\ pending' = pending + sessionSize
  /\ sessionSize' = 0
  /\ UNCHANGED singletonRun

AdmitAcquisition ==
  /\ phase = "acquisition"
  /\ phase' = "idle"
  /\ introduced' = introduced + sessionSize
  /\ acquired' = acquired + sessionSize
  /\ unseen' = unseen - sessionSize
  /\ pending' = pending
  /\ sessionSize' = 0
  /\ UNCHANGED singletonRun

Next ==
  \/ StartAcquisition
  \/ DeferAcquisition
  \/ AdmitAcquisition

NoRepeatedSingleton ==
  singletonRun < 3

Spec ==
  Init /\ [][Next]_vars

====
