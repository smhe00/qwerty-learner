# Automatic full V4 history reconciliation

Owner steering: 普通用户很难处理分叉，我们的程序按最优方案处理就行了.

Single executor Codex. Base product/main 1bce4bfa2afc4c712338bebc4bb6303293c8100d. This supersedes the prior ordinary-divergence refusal: valid same-account divergent snapshots are reconciled automatically; integrity, owner, session, CAS and lossless-restoration guards remain mandatory.

Policies: union immutable attempts by UUID; exact legacy logical payloads use maximum multiplicity (a documented conservative duplicate heuristic, never forged attempt UUIDs); retain both original full snapshots and candidate before cloud mutation. Rebase numeric keys and every known foreign key. Replay eligible FSRS histories only when complete enough to preserve existing review evidence; otherwise retain a coherent conservative state. Preserve manual exclusions. Select complete session variants deterministically rather than combining cursors. Merge existing achievements without minting new awards. Prefer the published cloud preference for concurrent overlapping settings; retain local-only settings. No ordinary user conflict-selection screen.

Use isolated Dexie decoding and independently checked re-export for Typeson/shared references. Read/verify pinned full cloud snapshot, build/audit candidate, archive both originals, guarded revision-CAS upload, then durable pre-mount Pull recovery/readback. No in-call retry of ambiguous cloud writes. A following independent startup must reconcile metadata and avoid duplicate uploads.

Validate unit invariants, repeated/reversed merge, legacy multiplicity, references, FSRS, sessions and failure injection; actual browser roundtrip and real eTest historical fork convergence. Merge product/main first, wait main gates, then fast-forward edgeone-test to identical SHA. master and production users remain outside scope. Record cleanup separately and preserve prior evidence.
