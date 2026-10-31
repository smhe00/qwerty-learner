# Supplementary daily examples and reviewed picture pairs

Status: IN_PROGRESS; source implementation ready, published UI qualification pending. Base product/main 3e5d50338565b8e01c8644bd4118afb6856e9ca4. No master release.

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
