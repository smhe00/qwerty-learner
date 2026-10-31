---
task_id: PC-IMAGE-CATALOG-EXPANSION-20261031
status: REVIEW
executor: Codex
base_commit: ec6fdddc525ac9f6d4b0f7f771494b478ef4be44
target_branch: product/main
release_to_etest: true
release_to_master: false
---

Owner requests expansion of the accepted PC picture/word-row and dictation UI, then eTest acceptance. Current staging base is da0e02f695c051393559651630e22c719549bfcb, an ancestor of main; production master remains 7eb3631f1614c8c78352a13bcbcae84ba165a290.

Imported coverage: 2,209 of 2,872 syllabus entries; 2,207 distinct words and unchanged 512x512 images, 2,208 word/first-meaning lookup keys, 58,908,608 original bytes. Forty-seven incompatible or uncertain source scenes are excluded; 616 entries lack directly matched source images. Audit accounts for every entry. Examples of excluded wrong senses: bear (animal vs endure), china/China, March/march, Miss/miss, IT/it, court (sports vs legal), trunk (elephant vs tree), firm (resolute vs company). Accepted scenes can support an existing secondary syllabus sense, not necessarily every sense. All 2,251 source candidates were screened in 23 contact sheets; this coarse visual screening is not a claim of per-pixel or real-device certification. Keep expansion subject to staging acceptance.

The previous word-only Map would overwrite differing duplicate entries, notably less. Lookup is now keyed by exact word and existing first translation, so both less entries work and arbitrary changed meanings/foreign dictionaries/case substitutions do not inherit pictures. No dictionary/schema, input, scheduler, auth, sync, record or global CSS changes. No phone illustrations enabled; existing hidden-answer neutral alt and unrevealed touch-recall behavior remain.

Provenance: Word Atlas contributors, CC BY 4.0, pinned commit 99c007673d38f02c418d8e4cd2e9ec90b5d40be5. No image pixels/bytes changed. Source/hash manifest, explicit exclusions, deterministic importer and entry audit are repository-visible; attribution remains in the existing About dialog with no caption below images.

Local validation: 16/16 dictionary contracts PASS; all 2,207 files decode and verify at 512x512; original SHA-256 identities PASS; deterministic registry/audit regeneration PASS; scoped ESLint PASS with zero diagnostics; Pages production build and CSS ownership PASS; YAML parse and node syntax checks PASS. Shanghai2027 dictionary has no diff and SHA-256 ffcbfcf7950f824c4d0666facd028171520ab9baf0b59e7fc91f5f9e7f3ab9b5. Focused production-browser matrix PASS 26/26 (52.9s, desktop light/dark): newly added device/zebra/less load only the current scene and retain exact original senses; bear/amusement have no photo/request; original layout, pause/resize, disclosures, error recovery, hidden-answer typing and touch spelling, unchanged review progress, attribution and mobile exclusion checks all remain passing. Local runner lacks CJK fonts; production CI installs them and retains per-state screenshots.

Transport: direct git push has no credential in this executor. To avoid thousands of binary API requests, the isolated codex/word-atlas-import-* branch workflow fetches only selected image paths at the pinned source revision, regenerates/validates the exact precomputed metadata and original hashes, and commits assets to that isolated branch only. It cannot advance main/etest/master. The final generated tree must equal the locally validated complete tree before normal main integration and unchanged mandatory Pages gates. No gate is skipped. Only after exact-SHA published Pages qualification may edgeone-test be fast-forwarded by the executor under this user authorization.

Asset transport PASS: isolated import workflow 41163259145 succeeded; generated asset commit 2ab9c710599142f616f2423c59ffe738c005c952 has exact complete tree 40c101cfcb4e2e6c6bd47b8911aa969529dc71c8, identical to the locally tested complete index. All 2,157 additional original files were committed; the three image/coverage contracts passed again on the runner. Integration adds only this task/report review status and transport evidence, without changing the validated application/assets.

Release execution: qualify the resulting exact SHA through unchanged mandatory Pages UI/deployment/published-regression checks, fast-forward etest once, then verify t.smhe.cn source identity, newly added asset samples and actual PC learning/dictation presentation. Exact post-commit CI and deployment acceptance evidence is retained in GitHub workflow/check metadata for that SHA. Owner acceptance of the expanded scenes remains pending on staging. This presentation acceptance does not certify real Cloud/Blob synchronization, and it does not authorize master.
