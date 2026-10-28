# Zhongkao 2027 short meanings

Status: REVIEW. Executor: Codex (owner-directed dictionary task).
Execution base: 49d78dfbcc50ac38ca51007ff43c17d29c7c11b9 on product/main.

Owner requests model extraction of shortMeaning for the existing Zhongkao 2027 dictionary, updating the same filename on GitHub. Scope: public/dicts/ShanghaiZhongkao2027.json and the optional Word type field; preserve all existing fields, record order and filename. No exercise UI change or deployment is requested in this turn. Publish on product/main, not master/edgeone-test.

This is a separate explicit owner assignment. Do not change CURRENT_TASK.md or the Circle latency executor's task/files.

Method: review all 2,872 entries in indexed batches; semantically summarize existing headword definitions. Existing usage notes and bilingual examples may support a missing headword definition, but do not copy derivatives, unrelated phrases, examples, grammar notes or misplaced definitions into the short gloss. Preserve useful distinct core senses without claiming exhaustive coverage or validated distractors. Keep original trans intact. Record any uncertain source entries and leave shortMeaning empty if unsupported.

Validation: parse JSON; verify unchanged count/order and exact equality of every pre-existing field against execution base; require string shortMeaning on every entry, report empty/long entries, inspect duplicated headwords and English leakage; check optional type and scoped static checks. Record results in interactive/reports/ZHONGKAO-SHORT-MEANING-20261028-report.md. Fetch and reconcile upstream before an expected-SHA, non-force GitHub update.

Source commit: 6da2c85d6846b56208b8a64ee6f8e1daa7373905. Complete data extraction: 2,865 nonempty glosses and 7 deliberately empty values for malformed source headwords. See the report for exact exceptions and validation.
