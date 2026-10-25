# Handoff integration compatibility checkpoint

PR41 targets product/main only. No staging/production branch promotion, ordinary
account activation, database changes or historical body-transport fix.

The 4741c305 handoff qualification passed122/122 on run40193631466. The standard
PR check subsequently reported one scope-only error-identity assertion failure:
request scope closes detached writes without poisoning a known stopped caller.
Do not ignore the failure or relax that assertion. Preserve the existing scope
contract instead: runHandoffScope defaults to returning the original thrown
error unchanged after draining and closing. Only the actual owning gateway
opts into certifyStopped:true. The Blob barrier consumes that internal stopped
certificate, verifies its terminal receipt, and rethrows the original cause.
Unknown provider writes still override any business error and remain protected.

Added one compatibility assertion without deleting or weakening existing tests.
Local actual gateway plus stopped tests PASS19/19, zero failures/skips; syntax
checks passed. Scope-alone original error identity and closed-proxy refusal
are both asserted. Final CI/merge status is not yet claimed in this checkpoint.

Native Git merge-tree qualification returned no conflicts for the reviewed
feature/base inputs. The independent CURRENT_TASK and newer main changes are
not overwritten. Existing Etest runtime remains34a3d15; master5528f79c.
History of failed PR checks remains available. Final PR merge result and exact
commit must be recorded after merge; do not interpret a merge-tree as a push.
