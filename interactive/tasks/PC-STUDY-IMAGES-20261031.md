---
protocol_version: '1.1'
task_id: 'PC-STUDY-IMAGES-20261031'
title: 'PC Learn meaning illustration pilot'
status: 'IN_PROGRESS'
target_branch: 'product/main'
base_commit: 'ebaa6f0c38b7299f20ee705f0e026971a2f16839'
recommended_executor: 'Codex'
allow_parallel_executors: false
report_file: 'interactive/reports/PC-STUDY-IMAGES-20261031-report.md'
release_to_master: false
---

# PC Learn meaning illustration pilot

Owner request: add pictures alongside the PC meaning display and experiment with placement. Preserve authoritative Shanghai 2027 vocabulary meanings, examples and learning logic.

This is an independently assigned UI task. Leave the Circle task and CURRENT_TASK pointer intact.

Use a right-side illustration outside normal text flow, only when there is enough desktop space. Enable 50 manually reviewed original Word Atlas images; retain exact attribution, license and SHA-256. Gate lookup on dictionary ID, exact word and original first meaning. Mobile does not mount/request the new images. Cold independent recall and pause must not expose image cues. A failed image must disappear without blocking meaning or actions.

Acceptance: production build/CSS contract, scoped type/lint, original dictionary contracts and image integrity tests, light/dark desktop keyboard/touch layout, cold/pause/resize/failure boundaries, mobile zero image requests. Preserve all existing UI gates. Develop and preview on product/main; no etest/master promotion.
