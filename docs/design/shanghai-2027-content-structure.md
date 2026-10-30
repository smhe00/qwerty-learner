# Shanghai Zhongkao 2027: lossless content organization

The existing dictionary is the source of truth. This change adds presentation structure only; it does not certify/correct the original source, change word identity, deduplicate headwords, rewrite meanings or replace examples.

## Data
Keep all existing properties, including the complete original trans array. Add optional content.version=1 and arrays senses, collocations, relatedWords, synonyms, antonyms, notes and extra. Every entry stores sourceIndex and the exact original text from trans. Each index must occur once across all groups. Do not split a source line or summarize long notes. Related-word classification identifies explicit English headword + part-of-speech lines; it does not infer a linguistic derivation.

Original first-line definitions (including untagged phrase definitions) and explicit part-of-speech definitions are senses. Explicit 词组/点拨/近义/反义 prefixes identify their groups. Other lines remain in extra. No Word Atlas data or code is incorporated.

## Presentation
Cold recall shows senses only. Collocations, related words, synonyms/antonyms and usage notes can reveal the answer and are absent from the cold card DOM. On exposure/reveal, a single native disclosure presents the full original groups. Long text scrolls inside the existing reading region without moving the primary action. Desktop keyboard Learn allows details on copy/full-answer hints; ordinary Typing retains its existing translation behavior. Read-only word cards offer grouped content. Legacy words or invalid/stale metadata fall back to the complete trans array.

## Verification and maintenance
Run node --test tests/dictionary/*.test.mjs and node scripts/structure-shanghai-dictionary.mjs. Use --write only to regenerate metadata after an explicitly authorized source-content change.
The source-preservation test reconstructs the pre-change Git blob exactly after removing only content (including names/order, examples/mask offsets, meanings, tags and pronunciation). It pins b5965a065232cee4658f2a380b26c09ad0858ed0; do not update this baseline to conceal an unintended source change.
The production visible-UI matrix includes dictionary-content.spec.ts for phone/tablet/desktop in both themes and deployments. No learning record schema migration is required; metadata is optional and preserved when existing review queues are copied.
