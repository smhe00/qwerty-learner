---
task_id: PC-WORD-IMAGE-ROW-DICTATION-20261031
status: REVIEW
executor: Codex
base_commit: 1c8f325488764e98f573534298ca05e5f7d4c8a1
target_branch: product/main
release_to_master: false
---

Replace the floating portal with a real picture/word row before examples and definitions. Measure the actual word so the image center aligns to it rather than to the full text block. Normal keyboard image is 176px, desktop touch 128px, touch spelling 96px to preserve meaning/input space. Only presentation code changes; input handlers, learning commits, scheduler, source dictionary/examples/mask offsets/assets/mapping remain unchanged.

Move mounting from Translation into Word's token row and the desktop touch word header. PC keyboard dictation (Typing hide-all and Learn independent spelling) can display the scene while keeping original letter visibility logic; touch spelling adds a neutral masked header. Hidden answers use generic alt='单词场景插画', including the initial empty-word state. Unrevealed tap recall and all mobile study still do not mount images. Original centralized license dialog and no-caption display remain.

Desktop card adjustments reclaim the phone-only bottom safe-area blank space and unused eyebrow-row height. Buttons retain their existing sizes; authoritative meanings and primary actions must remain visible. No global reset CSS imports or gate removals.

Initial Pages build/CSS ownership passed. Scoped ESLint: zero errors, three pre-existing Word/WordPanel warnings. First 16 desktop journeys: 14 PASS, two touch-dictation failures because the 128px row left only about 17% of the definition visible. Use a compact 96px image for the input-heavy touch-spelling card; keep the visibility assertions unchanged. New coverage verifies true center alignment, examples/meaning below the image, neutral alt/hidden letters and original Typing completion to the next word. After the compact touch-spelling correction, the 16 desktop journeys PASS. Final production build/CSS and eight center-alignment/dictation journeys PASS after adding the tall-word/status center offset. Scoped TypeScript reports zero diagnostics in the changed presentation area (the unrelated repository baseline remains). Typed masked ability successfully advances to able with its own scene in both themes.

Ordinary Typing dictation additionally uses the existing structured core senses instead of showing target-word collocations during the prompt. The original source lines are untouched and remain available in normal learning/read-only content; legacy dictionaries fall back as before. New assertions check that neither the prompt translation nor masked example reveals ability. A focused rebuild and two-theme check covers this final prompt-only safeguard. Published evidence follows the unchanged main deployment gates.

Final prompt-only safeguard: production build and CSS ownership PASS; Typing hide-all scene/core-sense/masked-example/no-details/next-word checks PASS 2/2 (both themes). Final scoped ESLint has zero errors and the same three unrelated baseline warnings. No dictionary/image/resource/type-schema diff. Worktree/base was rechecked at 1c8f325488764e98f573534298ca05e5f7d4c8a1 before integration.

The unchanged mandatory main deployment runs the full UI matrix and focused suite against its exact source commit, and only publishes after passing. CI/source marker evidence is attached through normal GitHub commit/workflow metadata. No etest/master promotion, no Circle task-pointer changes. Remaining scope: the reviewed 50-image PC pilot; mobile pictures and additional assets remain outside this task.
