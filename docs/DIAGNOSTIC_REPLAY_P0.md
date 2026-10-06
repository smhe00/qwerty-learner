# P0 Diagnostic Replay

Qwerty Plus can export two diagnostic formats:

- `qwerty-developer-trace-v1`
- `qwerty-developer-incident-v1`

The preferred field-debug workflow is:

```text
Settings
→ 开发诊断
→ 导出现场诊断包
→ Qwerty-Plus-Incident-*.json
→ local replay CLI
```

No DevTools/F12 command is required.

## Local replay

```bash
yarn diagnostic:replay ./Qwerty-Plus-Incident-2026-....json
```

The command is local-only and does not upload the file.

Exit codes:

- `0`: valid export, no replay anomaly found;
- `1`: invalid input / unsupported schema / tool error;
- `2`: at least one replay anomaly found.

When an anomaly is found, the CLI runs deterministic ddmin and writes a sibling `.min.json` file.

The minimized artifact uses the **same supported source schema** as the input and can therefore be replayed again with the same command.

## P0 anomaly classes

Current P0 oracles cover:

- `terminal-ui-divergence`
- `finished-session-evidence-after-terminal`
- `finished-checkpoint-regression`
- `invalid-session-index`
- `audio-owner-lifecycle-violation`
- `oversized-acquisition-classification`

## Evidence semantics

Replay output distinguishes:

- **observed** — directly present in trace/snapshot evidence;
- **derived** — inferred from an unambiguous replay context;
- **mixed** — depends on both observed and derived evidence.

P0 must not invent certainty when required evidence is absent.

Examples:

- an audio-owner violation is not reported unless an owner key and displayed word are both present;
- a metadata-less >20-word session is not automatically called an oversized Acquisition cohort;
- a pure Review session may legally contain more than 20 logical words.

## Minimizer guarantee

The minimizer is deterministic and preserves event order. It uses chunk-removal ddmin followed by a single-event deletion pass.

The result is intended to be **1-minimal with respect to the implemented deletion pass**, not a proof of a globally smallest mathematical trace.

Developer Trace is currently bounded to about 800 events, which is the target P0 operating range.

## Privacy

Do not commit real exported incidents, user backups, local databases or minimized field incidents into Git.

Repository regression fixtures must be synthetic/sanitized.

## Relationship to Simulation 2.0

P0 answers:

> “Given a real field incident, can the system identify and minimize the structural failure automatically?”

P1 will address a different question:

> “Can the virtual Learn product model proactively generate more of these failures before users encounter them?”
