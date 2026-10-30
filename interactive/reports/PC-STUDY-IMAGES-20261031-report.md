---
protocol_version: '1.1'
task_id: 'PC-STUDY-IMAGES-20261031'
status: 'IN_PROGRESS'
executor: 'Codex'
target_branch: 'product/main'
claim_base_commit: 'ebaa6f0c38b7299f20ee705f0e026971a2f16839'
---

# PC study illustration pilot

Implemented a 50-image controlled pilot from Word Atlas commit 99c007673d38f02c418d8e4cd2e9ec90b5d40be5. Original image bytes, license and attribution included. No authoritative dictionary JSON changes, no learning record/schema/auth/sync changes.

Placement: measured fixed portal to the right of the existing word stack or desktop touch card, outside normal flow. Hidden below 1200×650 or without sufficient right-hand space. ResizeObserver updates with expanded dictionary details. Visible only alongside disclosed meanings, hidden on pause/cold probes; dedicated mobile study never mounts the component. Image errors remove picture and caption.

Semantic review: compared contact sheets of the first 48 matched words plus library, remember, borrow, apple, banana and cat to the original syllabus meanings. Excluded about (different sense), act (action/perform mismatch), actually and ago (ambiguous scenes). The accepted 50 exact mappings and pinned first meanings are in src/resources/study-illustrations.json. These are illustrative scenes for a core sense, not coverage of every meaning or pronunciation. Remaining downloaded images are not enabled.

Validation pending: locked install, focused resource/browser tests, build/CSS, lint/type, required CI. Current local install is fetching packages slowly; the primary-runtime Chromium download returned a non-browser HTML error. No passing evidence claimed yet. Tests use the real Shanghai dictionary ID through a backward-compatible optional acquisition fixture parameter.

Next: complete checks, fix observed failures, push feature branch, review PR CI and screenshots, merge to product/main, verify published Pages. Preserve Circle task and branch roles. No production release authorized.
