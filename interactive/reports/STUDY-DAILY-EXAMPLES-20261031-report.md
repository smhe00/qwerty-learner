# Supplementary daily examples and reviewed picture pairs

Status: REVIEW. Implemented and published to Pages; feature SHA 02c9e2f4e3b21d0471a226643f1310a06fbca96b qualified. Base product/main 3e5d50338565b8e01c8644bd4118afb6856e9ca4. No staging or master promotion in this continuation.

Owner approved adding quality-comparable Word Atlas daily examples while retaining authoritative Shanghai 2027 content. Implemented a separate presentation catalog, not an append/reorder of authoritative example arrays. The complete dictionary SHA-256 remains ffcbfcf7950f824c4d0666facd028171520ab9baf0b59e7fc91f5f9e7f3ab9b5.

## Content scope and evidence

Pinned Word Atlas source 99c007673d38f02c418d8e4cd2e9ec90b5d40be5, CC BY 4.0, Word Atlas contributors. Fetched all 73 source chunks read-only; reviewed a broad selected daily-life set of 219 headwords, comparing daily English/Chinese with the original syllabus examples and their existing usages. Language review accepted 216 and deferred banana/milk (cereal) and medicine (pharmacist) for unnecessary added lexical difficulty. No IELTS examples were imported. This is Codex screening, not independent human certification or whole-library approval.

Independently inspected the corresponding original images in six labelled contact sheets. Ninety-two core scene pairs passed. Criteria require compatible main objects/actions/places; invisible time/frequency/kinship or preceding events are not certified, and per-pair notes record these limits. Ability repair/riding, water watering/drinking, plane landing/airborne, bridge wooden/stone, healthy cat/runner, device tracker/watering and other mismatches have no on-screen image. All 2,207 original asset files remain in the repository. The old broad image-sense audit still describes stored assets; the new example audit controls actual display eligibility. Remaining 2,653 dictionary entries are explicitly unreviewed, not silently imported or certified.

Source snapshots and explicit independent language/image decisions: scripts/data/word-atlas-daily-source.json and study-example-reviews.json. Deterministic generator: node scripts/import-study-examples.mjs. Runtime catalog: src/resources/study-examples.json; full inventory: docs/data/shanghai-2027-example-audit.json.

## Behavior

PC keyboard and tap study select one stable reviewed daily example per exact word/first-meaning/original-example-array guard; otherwise retain the original first valid example. A picture is allowed only for the explicitly bound daily sentence and matching stored source ID. It remains to the left of the word, with no per-card license caption. PC initial exposure/revealed study offers every valid original example under 考纲例句, with exact text/translation and no rewritten masks. Unrevealed dictation never mounts that original-answer detail and masks the daily surface, including reviewed inflections. Image alt text remains neutral. Phone continues using the original examples without pictures. Central About attribution now covers both texts and pictures.

No scheduling, learning-event identity, auth, sync, schema or persistence changes. The only learning-context change is accurately reporting an available example cue when the presentation includes a reviewed supplement (e.g. television previously lacked an original example).

## Validation so far

- node --test tests/dictionary/*.test.mjs: 21/21 PASS, including source fidelity, frozen originals, unique/inflected masks, independent scene decisions, mobile/foreign/stale-content fallbacks and deterministic regeneration.
- Scoped ESLint: zero errors, three existing warnings in Word/WordPanel.
- Production Pages build: PASS (26.19s); yarn verify:ui-css PASS. Existing bundle-size/Browserslist/Radix warnings retained.
- TypeScript full check: 143 diagnostics across the repository; none in the modified presentation files. Full repository typecheck is not claimed passing.
- Local production Playwright attempted; browser launch failed before app execution because Chromium 1091 is absent in this resumed environment. No local browser PASS claimed. Mandatory unchanged CI installs Chromium and runs Pages/EdgeOne visible-UI matrices; results pending.
- Added/updated browser contracts for paired images, negative device/ability examples, all original water examples, neutral dictation masks, zero original-answer details while masked and unchanged phone examples.

Next: push development candidate without changing the Circle task pointer, inspect exact-SHA UI/deploy CI and repair real failures, inspect published Pages, then record final evidence. Keep eTest pinned unless the authorized acceptance scope requires its promotion. Never master.

## First CI feedback

Development candidate bb82c40277ee6990471eba34dcee29e4a8f06374: Dictionary, Achievement and Learn Completion source gates PASS. EdgeOne production UI companion passed all 22 dictionary journeys, but the image suite caught four real clipping failures in PC touch exposure/dictation (both themes): daily label plus the inherited fixed three-line empty example area consumed the meaning/usage height. Retrieved and visually inspected the screenshots; no assertion weakened. Fix removes the unused fixed-height example reservation for reviewed **desktop daily** sentences only. Original phone spacing remains unchanged. Added a bounded, keyboard-focusable original-example scroll list and a regression reaching the final long hear example in both PC modes. New qualification pending.

The 45b7b417 requalification still reproduced the same four clipping ratios. Further CSS inspection showed DictionaryContent already removed the unused minimum height for these cards, so the initial fixed-height hypothesis was insufficient. The precise new cost was the standalone daily-label row. Moved the desktop source-category label inline into the example paragraph instead; no extra vertical row, same source distinction and full sentence. Long-original scrolling cases passed in that run. Assertions, contrast thresholds and primary-action visibility requirements remain intact.

Broadened the concrete wrapping boundary to bakery/cook/television (long daily sentences, multiple syllabus senses or no prior example). Compact PC tap pictures to 104px in exposure and 80px in spelling, retaining keyboard pictures at 176px and the existing word-center alignment. PC spelling already has an 独立拼写 header and labelled input, so omit its duplicate explanatory line to preserve space for a two-line sentence and meaning. Phone instruction/spacing remains unchanged. Added exposure+dictation painted-viewport checks for all three words in both themes; no visibility assertion relaxed.

The expanded e1edbb74 matrix correctly rejected long wrapped sentences with multi-sense meanings: bakery disclosure 96.3% visible, cook disclosure 30.6%, and cook spelling meaning 43.2%. The inline-label fix passed the prior baseline but did not solve this broader boundary. Use actual PC horizontal space: widen the desktop tap card from 600px to 720px (frame 880px), allow daily examples its full width instead of the inherited phone 470px cap, and use 8px/2px desktop example margins. This frees meaning height while keeping a readable sentence, all senses, the word/image row and the separate primary-action rail. Phone CSS is unaffected. Requalification required; no passing claim for rejected candidates.

## Final qualified result

02c9e2f4e3b21d0471a226643f1310a06fbca96b additionally pins the desktop overrides with data-desktop-tap-study, so lazy CSS order cannot restore the old phone-width cap. The final source, examples and stored images are on product/main; no authoritative dictionary byte changed.

Exact-SHA Pages deployment/UI run **41199832235 PASS**:

- EdgeOne production-build companion job 124533314880: 21 dictionary contracts, 22 dictionary UI journeys, 50 illustration/example journeys, 200 full visible-UI journeys and 17 primary-action journeys PASS.
- Pages production-build job 124533315124: 21 dictionary contracts, 22 dictionary UI journeys, 50 illustration/example journeys, 86 full visible-UI journeys, 17 primary-action journeys and 20 offline account UI journeys PASS. Intended scope skips are retained, not described as tests passed.
- Both production builds and global-CSS ownership checks PASS. Published deployment job 124535005898 verified the exact source SHA, actual Pages artifact 3930bceb7071e59487a73d56e5e99410da7cfb20 and nine live Chromium regression journeys PASS.
- Learning-logic source f6403dfafed6f6ab23a0b59c06bad6edd7a7d75c additionally passed Review Gate 41199236281 (126 Learn browser contracts), Mobile P0 41199236266, Learn Completion 41199236180, Learn Real Journey 41199236176 and Mobile Menu Completion 41199236187. Subsequent application changes were CSS only; these are not mislabelled as exact-02c9 source runs.
- Direct published-browser inspection saw footer 02c9e2f, ability's new repair sentence with no riding image, then able's swimming picture beside the word and its swimming daily sentence. Expanded 考纲例句 and verified the original reference-book sentence and translation remain accessible. Saved screenshot interactive/evidence/daily-example-pages-02c9e2f-1793449247544.jpg. Only anonymous Pages test activity; no real account/authentication/cloud writes.

Machine-readable evidence: STUDY-DAILY-EXAMPLES-20261031-acceptance.json. Routine UI delivery uses Pages; edgeone-test remains 714455a41bc49ed0e853a7225792e608f36ba999 and master remains 7eb3631f1614c8c78352a13bcbcae84ba165a290. No new Cloud/Blob or actual iOS/HarmonyOS device qualification is claimed. Whole-library semantic review remains incomplete: this batch approves 216 examples and 92 compatible scene pairs only; the other assets remain stored and unreviewed examples are not automatically enabled.

Completion checkpoint is a report/task/evidence-only commit after the qualified feature SHA. Historical exact-SHA evidence remains valid; no application, test or content changes are included in the checkpoint. Owner visual acceptance remains pending under REVIEW; the unrelated Circle task pointer is unchanged.
