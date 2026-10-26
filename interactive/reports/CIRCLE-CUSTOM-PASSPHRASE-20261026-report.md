# Circle custom passphrase report
Status: IN_PROGRESS; implementation complete, etest validation next.
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

## Next
Commit/push product/main, pin its exact application SHA on edgeone-test, await source marker and run isolated real two-user custom-create/join/owner-change/old-rejection/new-rejoin. Master remains 15fffa2c762037d8b29d1e5b953c729001ad5f0e; previous etest is db85edc7dbe796584ec4b0b3e38920ac7515db70.
