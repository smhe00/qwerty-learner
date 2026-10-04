---- MODULE DeferredLifecycle ----
EXTENDS Naturals

CONSTANT ResumePolicy

VARIABLES
  phase,
  clock,
  resumeAfter

vars == << phase, clock, resumeAfter >>

Init ==
  /\ phase = "deferred"
  /\ clock = 0
  /\ resumeAfter = 1

Tick ==
  /\ phase = "deferred"
  /\ clock < resumeAfter
  /\ clock' = clock + 1
  /\ UNCHANGED << phase, resumeAfter >>

ResumeDeferred ==
  /\ phase = "deferred"
  /\ clock >= resumeAfter
  /\ ResumePolicy = "production"
  /\ phase' = "resumed"
  /\ UNCHANGED << clock, resumeAfter >>

StayResolved ==
  /\ phase = "resumed"
  /\ UNCHANGED vars

Next ==
  \/ Tick
  \/ ResumeDeferred
  \/ StayResolved

ReadyDeferred ==
  phase = "deferred" /\ clock >= resumeAfter

Resolved ==
  phase = "resumed"

DeferredEventuallyResumes ==
  ReadyDeferred ~> Resolved

Spec ==
  Init
  /\ [][Next]_vars
  /\ WF_vars(ResumeDeferred)

====
