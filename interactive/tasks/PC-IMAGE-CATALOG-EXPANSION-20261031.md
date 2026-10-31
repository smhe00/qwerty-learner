---
task_id: PC-IMAGE-CATALOG-EXPANSION-20261031
status: REVIEW
executor: Codex
base_commit: ec6fdddc525ac9f6d4b0f7f771494b478ef4be44
target_branch: product/main
release_to_etest: true
release_to_master: false
---

Owner accepted the PC picture/word row and dictation presentation, then requested all suitable available Shanghai 2027 pictures and promotion to eTest for acceptance. This explicitly authorizes one staging promotion after Pages qualification despite the default restriction on UI-only staging builds. Do not modify the unrelated Circle task pointer or production master.

Import the pinned Word Atlas original WebP assets from the existing downloaded candidate package. Compare candidate meanings against all existing syllabus senses; exclude wrong homonyms/case normalization and unsuitable scenes rather than changing authoritative definitions. Retain source SHA, file hashes, excluded/missing inventory, license and central attribution. Bulk contact-sheet inspection is a screening pass, not a claim of pixel-by-pixel human certification. Retain exact image bytes and PC/mobile/dictation boundaries.

Validate file identity/dimensions, complete coverage accounting, no dictionary changes, deterministic regeneration, foreign dictionary/wrong meaning/case exclusions, production build/CSS ownership, representative newly added words and missing/mismatched fallbacks. Run unchanged mandatory Pages UI gates. Safely fast-forward edgeone-test only to the exact qualified main SHA, wait for t.smhe.cn to publish that SHA, and inspect the actual PC learning and dictation UI. Do not claim Cloud/Blob qualification from this asset-only acceptance test.
