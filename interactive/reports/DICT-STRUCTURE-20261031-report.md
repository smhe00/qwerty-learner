---
task_id: DICT-STRUCTURE-20261031
status: REVIEW
executor: Codex-dictionary-structure
target_branch: product/main
claim_base_commit: 64bb199f781248f3b8421a7f7fc2dad137ef75ee
validated_source_commit: 2e1ce8fbfdefe82055ebba23abeb2c73a2934800
release_to_master: false
---
# Shanghai Zhongkao 2027 content organization — completed

## Result
All 2872 dictionary entries retain their existing names/order, trans, shortMeaning, pronunciation, examples, start/end mask offsets and tags. Every one of the 5522 original trans lines has exactly one categorized entry with exact sourceIndex/text provenance. Counts: senses 3325; collocations 630; related words 694; synonyms 108; antonyms 180; notes 568; unclassified extras 17.
Original source blob b5965a065232cee4658f2a380b26c09ad0858ed0 is reconstructed byte-for-byte after removing only the added content property; the Node test verifies its Git blob hash. Duplicate headwords in their original positions are preserved.
The phrase-only dream entry retains its original collocation and uses its already-existing shortMeaning for the core cue. No definitions, examples or external content were added/rephrased. No Word Atlas assets or code were incorporated.

## Presentation
Shared DictionaryContent displays source senses first and puts complete supplementary source lines in one expandable disclosure. Unrevealed tests do not mount collocations/related words/notes. Exposure/reveal and read-only word cards offer full grouping. Desktop keyboard Learn uses the same visibility boundary; ordinary Typing translation retains its prior behavior.
Short structured phone cards use the actual example height rather than reserving an empty third line, while retaining the three-line clamp and primary actions. Structured controls are inert under pause overlays. Long notes stay within the existing reading scroller.
Old dictionaries/checkpoints or invalid/stale metadata fall back to complete original text. Optional metadata is preserved when review queues are copied. No schema migration, scheduler, auth, ownership or synchronization changes.

## Validation executed
Source candidate: 2e1ce8fbfdefe82055ebba23abeb2c73a2934800.
- Dictionary schema/content/fallback regressions: 13/13 PASS in both deployment jobs.
- Deterministic regeneration: 2872 entries PASS.
- Scoped ESLint, production Pages/EdgeOne builds and UI CSS ownership: PASS.
- New source-word browser journeys: 22 PASS per deployment (44 total); 8 non-desktop keyboard-only exclusions per deployment are intentional. Phone/tablet/desktop, light/dark, 320x568 disclosure visibility, long notes, cold masks, pause/resume, actual checkpoint refresh and separate desktop keyboard exposure/cold path.
- Existing full visible UI: Pages 86 PASS / 130 existing deployment/platform exclusions; EdgeOne 200 PASS / 16 existing exclusions. No existing test/gate/assertion was weakened.
- Existing primary-action/refresh/audio journey: 17/17 PASS in each deployment.
- Pages account UI/zero-auth requests: 20 PASS / 4 existing exclusions.
- Performance P0-P1 source, data-safety and TypeScript regression workflow: PASS.
- Learn Completion Journey: PASS.

Evidence:
- UI/build/dictionary: https://github.com/smhe00/qwerty-learner/actions/runs/41090805011
- Source/performance/type regression: https://github.com/smhe00/qwerty-learner/actions/runs/41090804883
- Completion journey: https://github.com/smhe00/qwerty-learner/actions/runs/41090804895
- PR: https://github.com/smhe00/qwerty-learner/pull/51

## Execution notes
The local Windows execution environment disconnected during checkout. No local test/build, manual screenshot review or physical iOS/HarmonyOS validation is claimed. Tests ran on GitHub's Node/Chromium runners.
Earlier CI caught (1) a Node-only esbuild harness inheriting ES5, fixed by targeting node20; (2) the legitimate phrase-only source entry, handled without changing its meaning; (3) a disclosure clipped by about 3px on the shortest phone, fixed in scoped layout. All latest validation above passed.
The final completion commit updates only this report and the task status on top of the validated candidate; application/data/test source is identical. Main was rechecked at 64bb199f781248f3b8421a7f7fc2dad137ef75ee before integration. Circle CURRENT_TASK ownership, etest and master remain untouched.
Pages deployment follows the normal product/main push pipeline; no production promotion is authorized or claimed.
