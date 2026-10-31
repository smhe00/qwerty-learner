---
task_id: STUDY-DAILY-EXAMPLES-20261031
status: IN_PROGRESS
executor: Codex
base_commit: 3e5d50338565b8e01c8644bd4118afb6856e9ca4
target_branch: product/main
release_to_master: false
---

Owner approved supplementary Word Atlas daily examples after comparing their quality with the unchanged Shanghai 2027 examples. This is a separate content/presentation task; leave the unrelated Circle CURRENT_TASK pointer and its executor unchanged.

Preserve authoritative dictionary bytes, example order/masks, meanings, pronunciations and learning identity. Add at most one separately attributed, reviewed daily example per guarded word/sense. Review naturalness, translation, syllabus compatibility and junior-school readability against the existing examples. Do not import the IELTS examples by default. Review image/core-scene compatibility independently: only an explicitly accepted pair may display a PC picture; retain other assets in the library without presenting mismatched scenes. Keep the picture beside the word. Keep mobile presentation and unrevealed touch recall boundaries unchanged. Preserve access to all original examples during PC initial exposure/revealed study. No random example switching mid-attempt; neutral image alt text and masked daily target during dictation.

Use a broad daily-life review set and explicitly account for unreviewed candidates. Do not equate automatic structure checks with semantic review or claim whole-library certification. Repository-visible pinned source, review decisions, deterministic import, audit and test evidence are required.

Validation: authoritative SHA unchanged; source/meaning/mask/image binding and missing/foreign/stale-content contracts; PC keyboard/touch exposure and dictation, phone no-change, original-example access and no hidden-answer leakage; production build, UI CSS contract, scoped lint, mandatory published Pages UI qualification. Push product/main normally, never force. Stage only if already authorized and needed for acceptance; no master release.
