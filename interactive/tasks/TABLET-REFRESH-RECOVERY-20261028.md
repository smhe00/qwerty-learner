# Tablet refresh recovery

Status: REVIEW. Executor: Codex-tablet-refresh.
Base: 6fc97272d274afc67ae4a25fcb8b92c4af0f7d6f (product/main).

Owner reports that refreshing during landscape tablet learning leaves preparing
audio/learning status and no reachable actions except the interaction toggle.
Clarification: controls are missing/unreachable, not all rendered buttons failing.

Independent UI task; leave CURRENT_TASK.md and Circle executor work untouched.
Reproduce refresh/foreground audio recovery and constrained viewport controls.
Keep one shared Learn session and accurate evidence: unavailable/unplayed audio
must not count as a successful listening exercise or bypass cold recall.

Validate stalled/blocked audio, initial background visibility, short viewport,
same-word/checkpoint retention, real choice-based fallback evidence, stale audio
callbacks, pause/resume, phone and desktop touch surfaces. Test the production
bundle as well as development. Retain existing authorization to publish the
tablet fix to etest after CI; no master release.

Owner additionally requests an independent layout for wide, short touch tablets.
Implemented left reading area and right action rail, keeping the same Learn
controller and DOM card through rotation. Source and focused checks complete;
continue exact-SHA CI and authorized etest promotion.
