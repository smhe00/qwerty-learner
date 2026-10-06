---- MODULE FreshBudget ----
EXTENDS Naturals

CONSTANT BudgetPolicy

VARIABLES
  phase,
  target,
  introduced,
  acquired,
  unseen,
  due,
  readyPending,
  allowedNow,
  freshSelected,
  pendingSelected

vars ==
  << phase,
     target,
     introduced,
     acquired,
     unseen,
     due,
     readyPending,
     allowedNow,
     freshSelected,
     pendingSelected >>

Min(a, b) ==
  IF a <= b THEN a ELSE b

Remaining(base) ==
  IF base >= target THEN 0 ELSE target - base

\* Due Review has priority in session composition, but current production
\* Learn is allowed to reserve bounded Acquisition capacity in a mixed
\* session. FreshBudget therefore models quota/accounting only; due-priority
\* correctness belongs to DuePriority.tla.
ExpectedAllowed ==
  Min(Remaining(introduced), unseen)

AcquiredAllowed ==
  Min(Remaining(acquired), unseen)

ExpectedPending ==
  readyPending

Init ==
  /\ phase = "idle"
  /\ target \in 0..2
  /\ introduced \in 0..3
  /\ acquired \in 0..introduced
  /\ unseen \in 0..3
  /\ due \in BOOLEAN
  /\ readyPending \in 0..2
  /\ allowedNow = 0
  /\ freshSelected = 0
  /\ pendingSelected = 0

SelectWithinBudget ==
  /\ phase = "idle"
  /\ phase' = "budget-selected"
  /\ allowedNow' = ExpectedAllowed
  /\ freshSelected' = ExpectedAllowed
  /\ pendingSelected' = ExpectedPending
  /\ UNCHANGED
       << target,
          introduced,
          acquired,
          unseen,
          due,
          readyPending >>

MutateAcquiredAccounting ==
  /\ BudgetPolicy = "acquired-accounting"
  /\ phase = "idle"
  /\ AcquiredAllowed # ExpectedAllowed
  /\ phase' = "budget-selected"
  /\ allowedNow' = AcquiredAllowed
  /\ freshSelected' = AcquiredAllowed
  /\ pendingSelected' = ExpectedPending
  /\ UNCHANGED
       << target,
          introduced,
          acquired,
          unseen,
          due,
          readyPending >>

MutateOverBudget ==
  /\ BudgetPolicy = "over-budget"
  /\ phase = "idle"
  /\ ~due
  /\ ExpectedAllowed < unseen
  /\ phase' = "budget-selected"
  /\ allowedNow' = ExpectedAllowed
  /\ freshSelected' = ExpectedAllowed + 1
  /\ pendingSelected' = ExpectedPending
  /\ UNCHANGED
       << target,
          introduced,
          acquired,
          unseen,
          due,
          readyPending >>

MutateIgnoresUnseen ==
  /\ BudgetPolicy = "ignores-unseen"
  /\ phase = "idle"
  /\ ~due
  /\ Remaining(introduced) > unseen
  /\ phase' = "budget-selected"
  /\ allowedNow' = Remaining(introduced)
  /\ freshSelected' = unseen
  /\ pendingSelected' = ExpectedPending
  /\ UNCHANGED
       << target,
          introduced,
          acquired,
          unseen,
          due,
          readyPending >>

MutatePendingConsumesBudget ==
  /\ BudgetPolicy = "pending-consumes-budget"
  /\ phase = "idle"
  /\ ~due
  /\ readyPending > ExpectedAllowed
  /\ phase' = "budget-selected"
  /\ allowedNow' = ExpectedAllowed
  /\ freshSelected' = ExpectedAllowed
  /\ pendingSelected' = ExpectedAllowed
  /\ UNCHANGED
       << target,
          introduced,
          acquired,
          unseen,
          due,
          readyPending >>

StaySelected ==
  /\ phase = "budget-selected"
  /\ UNCHANGED vars

Next ==
  \/ SelectWithinBudget
  \/ MutateAcquiredAccounting
  \/ MutateOverBudget
  \/ MutateIgnoresUnseen
  \/ MutatePendingConsumesBudget
  \/ StaySelected

FreshBudgetSound ==
  phase # "budget-selected"
  \/
    /\ allowedNow = ExpectedAllowed
    /\ freshSelected <= allowedNow
    /\ freshSelected <= unseen
    /\ pendingSelected = ExpectedPending

Spec ==
  Init /\ [][Next]_vars

====
