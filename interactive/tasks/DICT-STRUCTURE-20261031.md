---
task_id: DICT-STRUCTURE-20261031
status: REVIEW
executor: Codex-dictionary-structure
target_branch: product/main
base_commit: 64bb199f781248f3b8421a7f7fc2dad137ef75ee
report_file: interactive/reports/DICT-STRUCTURE-20261031-report.md
release_to_master: false
---
# Lossless organization of Shanghai Zhongkao 2027
User explicitly authorized implementing the agreed structure. Existing syllabus content is the authority: preserve every word, order, trans string, shortMeaning, pronunciation, example, mask offset and tag. Do not import Word Atlas meanings or add generated paraphrases. Group existing lines into senses, collocations, related words, synonyms, antonyms, usage notes and unclassified extras.
Retain trans as original source and exact sourceIndex/text provenance. Render core senses during cold tests; make the original supplementary content expandable only after answer exposure. Keep primary actions visible on short phones, tablets and desktop in both themes. Preserve legacy dictionaries/checkpoints through a full-text fallback.
This is a separate user-assigned dictionary task; do not take over or edit the Circle CURRENT_TASK ownership pointer.
Required validation: original Git blob reconstruction; exhaustive source-line coverage and deterministic regeneration; malformed/legacy metadata fallback; production Pages/EdgeOne UI matrix with cold-probe leak and long-note/refresh/action tests; build and UI CSS ownership. Integrate into product/main without force push after remote checks. No staging/production promotion.
