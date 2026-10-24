# Lossless Unicode import across Dexie JSON chunks

Single executor Codex; development base 51d2124360b620d6d84742b5359d6991f1f60567. Owner authorization on 2026-10-24: repair Chinese chunk decoding, retain lossless validation, merge product/main then promote etest, publish master only after successful staging validation. No existing user data access, cleanup, migration, or manual rewriting.

Root reproduction: dexie-export-import 4.0.7 JsonStream slices bytes and decodes each Blob independently. A 1 MiB boundary inside UTF-8 changes a Chinese character into U+FFFD. Disposable Chromium reproduced the reported reviewRecords words.element.trans.element audit failure; originals remained unchanged.

Repair all local Dexie import entry points (V4 audit, M4 candidate, automatic merge, durable restore and legacy backup import) without changing archive bytes/fingerprints, formats, dependencies or lossless checks. Preserve bounded chunk parsing and Typeson revival. Cover Chinese, accented characters, supplementary Unicode, escape boundaries, shared references and negative-zero rejection. Use synthetic profiles/accounts only; retain ambiguous write/cleanup outcomes without replay.

Validate local browser regressions, cloud tests, lint/build and relevant CI. Strengthen published etest historical full-V4 E2E with >1 MiB Unicode history, exact translations and six-table union, startup download and repeated-startup no-write checks. Follow main -> etest -> master order with exact SHA and release-ready evidence. After release, only public version/health confirmation is required; no new production functional test is requested.
