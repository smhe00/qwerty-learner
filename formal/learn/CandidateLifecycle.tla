---- MODULE CandidateLifecycle ----
EXTENDS Naturals

CONSTANT CandidatePolicy

VARIABLES
  phase,
  lifecycle,
  due,
  candidateKind,
  selectedCount

vars ==
  << phase,
     lifecycle,
     due,
     candidateKind,
     selectedCount >>

LifecycleDomain ==
  {"unseen", "introduced", "pending", "admitted", "excluded"}

Init ==
  /\ phase = "idle"
  /\ lifecycle \in LifecycleDomain
  /\ due \in BOOLEAN
  /\ (due => lifecycle = "admitted")
  /\ candidateKind = "none"
  /\ selectedCount = 0

SelectFresh ==
  /\ phase = "idle"
  /\ lifecycle = "unseen"
  /\ phase' = "selected"
  /\ candidateKind' = "fresh"
  /\ selectedCount' = 1
  /\ UNCHANGED << lifecycle, due >>

SelectPending ==
  /\ phase = "idle"
  /\ lifecycle = "pending"
  /\ phase' = "selected"
  /\ candidateKind' = "pending"
  /\ selectedCount' = 1
  /\ UNCHANGED << lifecycle, due >>

SelectDue ==
  /\ phase = "idle"
  /\ lifecycle = "admitted"
  /\ due
  /\ phase' = "selected"
  /\ candidateKind' = "due"
  /\ selectedCount' = 1
  /\ UNCHANGED << lifecycle, due >>

SelectForce ==
  /\ phase = "idle"
  /\ lifecycle = "admitted"
  /\ phase' = "selected"
  /\ candidateKind' = "force"
  /\ selectedCount' = 1
  /\ UNCHANGED << lifecycle, due >>

MutatePendingAsFresh ==
  /\ CandidatePolicy = "pending-as-fresh"
  /\ phase = "idle"
  /\ lifecycle = "pending"
  /\ phase' = "selected"
  /\ candidateKind' = "fresh"
  /\ selectedCount' = 1
  /\ UNCHANGED << lifecycle, due >>

MutateAdmittedAsFresh ==
  /\ CandidatePolicy = "admitted-as-fresh"
  /\ phase = "idle"
  /\ lifecycle = "admitted"
  /\ phase' = "selected"
  /\ candidateKind' = "fresh"
  /\ selectedCount' = 1
  /\ UNCHANGED << lifecycle, due >>

MutateExcludedSelected ==
  /\ CandidatePolicy = "excluded-selected"
  /\ phase = "idle"
  /\ lifecycle = "excluded"
  /\ phase' = "selected"
  /\ candidateKind' = "force"
  /\ selectedCount' = 1
  /\ UNCHANGED << lifecycle, due >>

MutateDuplicateCanonical ==
  /\ CandidatePolicy = "duplicate-canonical"
  /\ phase = "idle"
  /\ lifecycle = "unseen"
  /\ phase' = "selected"
  /\ candidateKind' = "fresh"
  /\ selectedCount' = 2
  /\ UNCHANGED << lifecycle, due >>

StaySelected ==
  /\ phase = "selected"
  /\ UNCHANGED vars

Next ==
  \/ SelectFresh
  \/ SelectPending
  \/ SelectDue
  \/ SelectForce
  \/ MutatePendingAsFresh
  \/ MutateAdmittedAsFresh
  \/ MutateExcludedSelected
  \/ MutateDuplicateCanonical
  \/ StaySelected

CandidateLifecycleSound ==
  phase # "selected"
  \/
    /\ selectedCount = 1
    /\ CASE candidateKind = "fresh" ->
              lifecycle = "unseen"
          [] candidateKind = "pending" ->
              lifecycle = "pending"
          [] candidateKind = "due" ->
              lifecycle = "admitted" /\ due
          [] candidateKind = "force" ->
              lifecycle = "admitted"
          [] OTHER -> FALSE

Spec ==
  Init /\ [][Next]_vars

====
