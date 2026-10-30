---
protocol_version: '1.1'
task_id: 'PC-STUDY-IMAGES-20261031'
status: 'IN_PROGRESS'
executor: 'Codex'
target_branch: 'product/main'
claim_base_commit: 'ebaa6f0c38b7299f20ee705f0e026971a2f16839'
validated_source_commit: '230e599548262a240a34616136248d98a3eb016e'
release_to_master: false
---

# PC Learn meaning illustration pilot

## Result

PC Learn shows a scene illustration to the right of the original meaning/word area during exposure or answer disclosure. Keyboard Learn and desktop touch Learn share the component. The fixed, measured side placement leaves the existing text, letter sizing and primary actions in their original layout. Below 1200×650, or without sufficient right-hand space, the picture is not mounted. ResizeObserver follows expanded text; pause/cold probes remove the illustration. Dedicated mobile study never mounts or requests it. Failed images remove both picture and caption, and the next word can still load its own picture.

No authoritative dictionary JSON, examples/mask ranges, Word schema, scheduler, learning record, auth or sync changes. Other dictionaries and ordinary Typing retain their previous presentation.

Visual review also found a pre-existing PC touch clipping issue: a one-line example reserved three lines, leaving only about 2% of the usage disclosure visible. Scoped structured PC touch examples now use their actual height while retaining the existing three-line clamp. The disclosure and expanded original collocations are tested with the image and primary action visible, without changing learning progress.

## Assets and semantic review

50 original 512px WebP files (1,305,404 bytes) from Word Atlas commit 99c007673d38f02c418d8e4cd2e9ec90b5d40be5. Original bytes/pixels are unchanged. Live links show Word Atlas contributors and CC BY 4.0; full license/provenance is shipped under public/images/word-atlas/.

Compared contact sheets of the first 48 exact matched words plus library, remember, borrow, apple, banana and cat to the original syllabus meanings. Excluded about (different sense), act (action/perform mismatch), actually and ago (ambiguous scenes). The accepted 50 exact mappings, pinned first meanings and original SHA-256 values are in src/resources/study-illustrations.json. Runtime lookup requires the Shanghai 2027 dictionary ID, exact word and unchanged first authority meaning. These illustrate a core sense; they do not replace definitions or represent every sense. Remaining downloaded images are not enabled.

## Changed areas

- DesktopStudyIllustration: scoped CSS, measured portal, responsive/pause/error lifecycle, accessible image and separate 24px credit link targets.
- studyIllustrations.ts/catalog/public images: reviewed registry, static originals and attribution.
- Translation/WordPanel and desktop MobileWordPractice branch: visible-meaning and cold-probe boundaries, no mobile mount.
- Resource tests: every original file hash and exact authority mapping, foreign/stale/unreviewed lookup rejection.
- Focused browser suite: keyboard/touch, both themes, geometry/contrast/actions, pause/resize/progress, cold/mobile zero requests, failure recovery/next-word image.
- Acquisition fixture: backward-compatible optional dictionary ID, preserving all existing cet4 defaults.
- UI workflow: adds focused tests/lint and retains both root and relative e2e artifacts. Existing gates remain intact.

## Validation

Application/test source candidate: 230e599548262a240a34616136248d98a3eb016e.

| Check | Result / evidence |
| --- | --- |
| Original image SHA-256 and authority mapping | PASS, all 50; independent local Python verification; dictionary diff empty |
| Dictionary/image resource contracts and deterministic regeneration | PASS in both CI deployment builds |
| Scoped ESLint; Pages/EdgeOne production build; global CSS ownership | PASS in both CI deployment builds |
| New illustration journeys | PASS, 16 per deployment; 20 intentional non-desktop PC-only exclusions per deployment |
| Local final Pages production build and CSS contract | PASS |
| Local layout journeys after the PC disclosure fix | PASS 4/4: keyboard/touch × light/dark, visible/expanded original collocations, pause/resume/resize and unchanged review info |
| Performance/source/data-safety/TypeScript branch gate | PASS, https://github.com/smhe00/qwerty-learner/actions/runs/41137990059 |
| Learn completion journey | PASS, https://github.com/smhe00/qwerty-learner/actions/runs/41137990188 |
| Existing full visible UI, primary actions and Pages account gate | PENDING |

UI evidence: https://github.com/smhe00/qwerty-learner/actions/runs/41137990080
PR: https://github.com/smhe00/qwerty-learner/pull/52

## Visual review and iteration

Reviewed actual production-bundle screenshots for both PC modes in light/dark at 1440×900. Word/meaning and primary controls remain clear with the illustration to the right. CI installs Chinese fonts; the local runner lacks CJK fonts, so its final screenshots verify geometry/link spacing rather than Chinese glyph rendering. Final CI screenshot review pending. New PC-only disclosure assertions reproduced the clipping before the scoped CSS fix and passed afterward.

Initial CI caught an inline wrapped license link whose bounding box included blank space and a test selector using the mobile pause label. Separate credit rows corrected hit geometry; a subsequent WCAG 2.2 audit required 24px minimum targets. Final local layout/contrast/target-size checks pass. No assertion, test state or required gate was removed. Earlier source candidates were 94ec4b897cf9504de17064336753ccdd9a2b4c7e and b3acc9f9b4b3022d92177fa54844b79c3d6e326d.

## Git and handoff

Base and latest checked origin/product/main: ebaa6f0c38b7299f20ee705f0e026971a2f16839. Source commits are on codex/pc-study-images-20261031. Circle CURRENT_TASK and its files remain untouched. Neither edgeone-test nor master is advanced.

Next: inspect final full UI results/artifacts, integrate the unchanged validated source with this completion report into product/main after another upstream check, then verify exact published Pages source and the PC illustration. This report remains IN_PROGRESS until that validation is complete.

Remaining scope: 50-image PC experiment; remaining images and other study surfaces are future work. Chromium evidence does not certify all desktop browsers or physical mobile platforms.
