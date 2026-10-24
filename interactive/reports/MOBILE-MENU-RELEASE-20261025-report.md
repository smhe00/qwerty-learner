# Mobile menu release checkpoint

Status: IN_PROGRESS; no master update yet. Owner explicitly requested 发布. Intake main c590c93a; implementation PR #40 previously passed 12 focused tests/types/lint/build on 2cf88073 with documentation-only follow-up.

Initial exact-SHA Pages run 40111804862/job120924908583: build/deploy/source propagation PASS; published regression 4/5 PASS. Failure was getByText('移动端成就即将开放') in pages-regression.spec.ts:214. The preceding user-authorized feature intentionally removed that placeholder. Replace obsolete expectations with actual five-entry navigation, 34 locked mobile achievements, five hidden identities, no unlock/detail bypass, Focus default, safe return, existing Learn flow, and zero cloud requests. No runtime app change.

Required next: exact candidate Pages and Cloud admission -> eTest same SHA -> real browser/Blob/three-device/release-ready -> master same SHA -> canonical HTTPS source/health/mobile checks. Retain failed admission and test outcomes. Local shell Git cloning was unavailable (DNS resolution failure); source and guarded writes use the connected GitHub tools, validation uses existing CI.
