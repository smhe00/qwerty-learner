---
task_id: PC-STUDY-IMAGES-LEFT-20261031
status: REVIEW
executor: Codex
base_commit: a2320ba90b7717ad39c0c05ae1de2ab257d4e0d0
target_branch: product/main
release_to_master: false
---

User requests the image to the left of the word without the source/CC caption below it.

Changes: mirror measured placement to 36px left of the existing text/card boundary and align the image top with the current word. Keep fixed placement outside text flow and 32px viewport edge guard; hide instead of compressing text when space is insufficient. Remove figcaption and its unused link CSS/event handling. Move Word Atlas contributors, project and CC BY 4.0 links and original-image status into the existing footer license dialog with 44px link targets. Existing image files, attribution/license files, mappings and authoritative dictionary remain unchanged.

Focused journeys now assert left placement, word-top alignment, no caption/links, existing content/pause/resize/progress conditions, and accessible attribution in the footer dialog. No existing gate/assertion is weakened; right-side geometry expectations are replaced with the owner-requested left-side expectations.

Validation executed:
- Locked-dependency Pages production build: PASS; global CSS ownership: PASS.
- Scoped ESLint for DesktopStudyIllustration and Footer: PASS.
- TypeScript: no diagnostics in either changed component. Repository-wide tsc still reports the pre-existing ES5 iteration/dev-tool baseline; no repository-wide PASS is claimed.
- Focused desktop layout/dialog journeys: PASS 4/4, keyboard/touch × light/dark. Left clearance, word-top alignment, absence of image caption/links, intact original disclosure content, pause/resize and unchanged review data, credit links and dialog contrast/geometry all checked.
- After testing the final source entry, reset only the test's touch scroller before capturing its collapsed default view. This is test-only setup, not an application change; targeted rerun PASS 2/2 in both touch themes.
- Manually inspected production-bundle layout screenshots. This local host lacks CJK fonts, so final published validation uses the established CI fonts/browser and actual public page.

No auth, sync, learning record, scheduler, asset/mapping or dictionary changes. The main push retains the existing production UI/deployment gates; no gate is narrowed. Its exact source commit, CI results and published marker are attached through normal GitHub commit/workflow metadata. Pages deployment must pass those gates before updating the preview.

Git: origin/product/main rechecked at a2320ba90b7717ad39c0c05ae1de2ab257d4e0d0 before integration, no divergence. Routine UI follow-up is pushed to product/main after focused local validation, with existing UI CI gating publication. Circle CURRENT_TASK, etest and master remain untouched. No full-image rollout or production release is authorized.

Build inspection caught that the locked Tailwind version does not emit min-h-11. Use the explicit min-h-[44px] utility and assert actual painted link height >=44px; no dependency update or CSS gate change. Final four-state rerun covers this correction.
