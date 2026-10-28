# Three-way Learn input preference and universal keyboard cues

Status: REVIEW (implemented, automated checks passed, etest bfe0672 verified). Executor: Codex-tablet-input. Base: 3bd0a6c781ee3ff13152ec4e038dd99a3ac39896.

Owner requests adding Auto to the existing touch/keyboard button, and clarifies
that any real key should enable keyboard operation and cues in every layout.
Keep one owner for this UI task; the unrelated CURRENT_TASK Circle lease remains untouched.

Scope: existing desktop/mobile Learn selectors, device-local remembered choice,
passive app-wide keyboard intent, compact-layout cues and focused browser tests.
Layout continues to follow screen/input capabilities; keyboard use must not
force phone/tablet into a desktop shell. No hardware enumeration claims.

Acceptance: Auto/Touch/Keyboard cycle; manual preference survives reload and wins
over inferred spelling; keyboard intent remains session-local, enables hints
from any route without stealing editor/menu keys; mobile/tablet retain controls
and current session; no fabricated learning records or changed grading policy.
Validate selector, mobile keyboard, desktop tap, affected mobile lifecycle and
compact geometry tests; scoped lint/typecheck and build. Record real results.

Publish product/main. Existing owner instruction to deploy this tablet iteration
to etest after CI remains authorized; this overrides the routine-UI etest default.
No master promotion. Report: interactive/reports/LEARN-INPUT-AUTO-20261028-report.md.
