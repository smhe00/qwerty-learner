# Unicode chunk import repair — checkpoint

Base: 51d2124360b620d6d84742b5359d6991f1f60567. Status: IN_PROGRESS.

Observed screenshot: Backup V4 independent roundtrip value mismatch: reviewRecords fields words.element.trans.element. Existing-session q.smhe.cn Chrome startup and local export both fail. No user backup accessed.

Confirmed library defect in isolated Chromium: byte slices independently decoded as UTF-8 corrupt a character crossing 1 MiB; full-slice control preserves values. Exact capture message reproduced with a synthetic forced independent audit. Production-user cause remains unconfirmed until the repaired client runs against that local dataset.

Next: add regression, implement shared import transport adaptation, verify main then etest and publish only qualified identical SHA. No existing user data may be changed by this task.

## Implementation and local proof

All five application Dexie import calls now consume createDexieImportBlob: workspace V4 independent audit, M4 candidate, guarded durable restore, automatic merge scratch copies, and legacy backup import including metadata peeking. The adapter converts non-ASCII UTF-16 units to equivalent JSON Unicode escapes for LOCAL decoding only. Typeson revival, chunk size, account/session guards, source-row audit, independent readback and negative-zero refusal remain intact. No dependency, cloud API, payload/fingerprint, or stored-row normalization changed.

The temporary import representation grows (Chinese typically 2x and supplementary characters 3x in bytes); the existing chunked parser remains bounded. Original backup/cloud bytes remain unchanged. No existing user data or production account was accessed.

- Red: new synthetic >1 MiB browser regression failed on the old importer with the exact reported words.element.trans.element error.
- Green: 122/122 full workspace Chromium tests, including all three new Unicode tests (5.2 minutes). All five import paths exercised, including legacy import and M4; retained negative-zero rejection passed.
- Existing cloud contracts: 583/583; new code-unit contracts: 2/2, covering all 65,536 UTF-16 units, Typeson metadata and literal U+FFFD preservation.
- TypeScript baseline/current: 144/144, introduced 0.
- Full lint: 0 errors, existing 133 warnings. Build passed (25.79 seconds).
- Lint-only equivalent regex spelling was followed by the exhaustive code-unit tests. Exact committed main CI will run the browser suite again.

The staged live E2E now seeds 700 synthetic historical reviews (>1 MiB) with Chinese, accents and emoji and verifies exact translations, six-table startup download, automatic forks, archives and repeat-startup no-upload. Execution/release evidence pending main -> etest promotion.

Final test-fixture refinement: the escaped Date tag is nested under words, so the same large synthetic histories exercise both S2 and the existing M4 unchanged-review proof. Targeted final Unicode browser tests: 3/3 passed (27.0 seconds), including full large-history M4 candidate checks. No application logic changed in this refinement.
