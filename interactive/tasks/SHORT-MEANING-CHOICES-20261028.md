# Short meaning choice integration

Status: REVIEW. Executor: Codex. Base: d8fd93aa750857bdefb97960d228fa4fe81f33f4 (product/main).

Owner requests: no listening/word-to-meaning choice exercise when shortMeaning is absent/empty; use shortMeaning for eligible choices. Apply to shared mobile/tablet/desktop Learn surface. Whitespace and malformed non-string values are unavailable too. Keep exposure, cloze, recall, spelling and full-definition feedback; missing choice data falls back to existing recall without skipping the learning item or fabricating completion. Filter distractors without short glosses and duplicate/overlapping gloss senses; no fallback to full trans. Preserve shortMeaning when the shared queue is projected after completion. Listening now displays meaning options, so evidence must reflect hidden orthography and visible meanings.

Separate explicit owner assignment: leave Circle CURRENT_TASK/task untouched. Push to product/main. This turn requests implementation, not an etest/master release; no staging/production promotion.

Validation: focused choice/selector contracts, actual shared UI on phone and desktop, missing/empty/whitespace target fallback, sparse/overlapping pools, successful and failed audio, refresh, post-answer detail and queue retention; scoped lint/build and existing affected audio/tablet regressions. Persist results and exact source SHA in interactive/reports/SHORT-MEANING-CHOICES-20261028-report.md; fetch and use expected-SHA non-force push.

Source commit: 47561146784a07a65e6ef8c515dc93b91dab7171. Implementation and focused validation complete; see report for source limitations, pre-existing diagnostics, and repaired external-audio test fixture.
