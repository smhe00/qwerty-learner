# Circle custom passphrase report
Status: REVIEW; implementation and real etest Circle validation complete.
Base: 495c77329a2e0a5c662d64b37c61e6c0d055d8f6. Claim: 9b0c8bb961238ce61f5f2b641c4f9297079c38ab.
Workspace: C:/Users/peter/Documents/Codex/2026-10-26/qwerty-circle-passphrase.

## Behavior
Owner confirmed passphrase-only joins. Create accepts an owner-defined NFC-normalized, trimmed 2–32-codepoint phrase, including Chinese/English/mixed text, case-sensitive. Owner management supports changes; old invitation stops new joins while existing members stay. Server stores a hash/index, never plaintext; local copied invitations carry revision hints and disappear after a fetched rotation. Existing QC3 invitations and old pending creations remain compatible. No KV, CAS, locks or learning/sync changes.

Changed areas: bounded service and storage allowlist; shared passphrase normalizer; transport create whitelist and POST /C/invite route; Circle client and UI; cloud/native receiver/browser tests; two Circle docs. The original fingerprint permits safe same-operation creation recovery after rotation without restoring the old invitation. Existing early native body reception is preserved.

## Local evidence
- node --test tests/cloud/*.test.mjs: 931/931 PASS, including 23 seven-day tests and full native-handler Chinese create/rotation/join; no mocked-Web-stream assumption.
- Playwright Circle suite: 10/10 PASS (57s). Includes PC entry/overlay, phone/320px/dark, creation retry identity, occupied phrase editable, owner rotation, stale local invitation hiding, phrase-only join, account changes and learning-row preservation.
- First browser attempt revealed the helper text was part of the create input accessible name; interrupted, fixed with explicit label/description, then all ten passed. No assertions weakened.
- Scoped ESLint for src/circle/client.ts and src/pages/Circle/index.tsx PASS. Full tsc remains blocked by existing repository diagnostics; no diagnostics under src/circle or src/pages/Circle after fixing the new revision-map type guard.
- Final yarn build PASS (30.01s, after accessible-label fix); existing chunk-size/Browserslist warnings.
- Visual inspection: compact PC creation/retry screenshot has one readable form and explicit error, no blank right-hand panel; browser phone checks have no horizontal overflow.
- Logs/screenshots outside repo: C:/Users/peter/Documents/Codex/2026-10-26/circle-ui-preview/passphrase-*.log and worktree test-results/.

## Boundaries
No atomic global reservation: normally duplicate phrases reject; simultaneous collisions fail joins instead of choosing a circle. Owner changes should be serialized. A join overlapping rotation can commit membership before its conflict response. Interrupted changes may retain stale hash-index objects (not membership authority); activity sweeps do not erase control objects. These no-lock limits are documented. Phrases are invitation secrets rather than account passwords. Synthetic social accounts retain the existing conservative deletion hold; close test circles after validation. No physical-device or production qualification claimed.

## Deployed evidence
Application SHA: **951f88ba2a9f6b6db81b45523b4ee1e998d503ab**. Normal development push and leased fast-forward of edgeone-test from db85edc7dbe796584ec4b0b3e38920ac7515db70. https://t.smhe.cn/source-commit.txt returned 951f88b before the real test. Report-only completion remains on product/main; etest stays pinned to this application SHA.

Real browser + private Blob, two freshly registered synthetic accounts:
- PC Learn toolbar -> create with Chinese/English phrase: 202, 5963 ms; named circle visible.
- Second account UI phrase-only join: 202, 5715 ms; correct circle visible.
- Nonowner POST /invite: 403 not_circle_owner.
- Owner UI changes phrase: 202, 4960 ms; current phrase displayed for copying.
- Existing member GET after rotation: 200; membership preserved.
- Member leaves: 202; old phrase rejoin: 404 invalid_invite; new phrase rejoin: 202, correct circle.
- Close synthetic circle: 202. Circle 654a098132bb0f2b03368893 closed. Synthetic accounts 2833432a2ceaabfe723d8c7a6afcdcf4 and 20ae8fa630469f565e4aea2cf570865d retained under the existing social-data deletion hold; no bypass, user account or learning data used. Credentials were process-only and not persisted.
- Live evidence: C:/Users/peter/Documents/Codex/2026-10-26/circle-ui-preview/passphrase-live.log, passphrase-live-create-form.png, passphrase-live-owner.png; replay script live-circle-passphrase.cjs requires CIRCLE_EXPECT_SHA.

Exact-SHA CI successes:
- Circle UI + scoped TypeScript/lint/build + Pages no-cloud boundary: https://github.com/smhe00/qwerty-learner/actions/runs/40330059601
- Circle Core Gate: https://github.com/smhe00/qwerty-learner/actions/runs/40330059578
- Cloud Sync Gate: https://github.com/smhe00/qwerty-learner/actions/runs/40330059728
- Pages deployment: https://github.com/smhe00/qwerty-learner/actions/runs/40330059756

This is Circle-specific etest acceptance, not full-product release qualification. At reporting time existing broader etest automatic-maintenance (40330079162), safe-merge pilot (40330079168), and account-handoff scope (40330078894) workflows reported failures; other broad journeys were still running. Their root causes are not certified by this task, and no master promotion is authorized or attempted. Master remains 15fffa2c762037d8b29d1e5b953c729001ad5f0e.

## Handoff
Ready for user review at https://t.smhe.cn/. Existing pending legacy creates can finish with their saved operation and then set a custom phrase in management. No remaining Circle implementation work. Physical-device acceptance, a hard global uniqueness allocator, and broader production qualification are outside this task.

