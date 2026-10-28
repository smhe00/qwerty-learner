# Zhongkao 2027 short meanings — review handoff

Date: 2026-10-28 (Asia/Shanghai). Status: REVIEW.
Execution base: `49d78dfbcc50ac38ca51007ff43c17d29c7c11b9`.
Source commit: `6da2c85d6846b56208b8a64ee6f8e1daa7373905`.
Source tree: `0bd159c23cebd6cb25565e32aeee0b17b3692da2`.
Target: `product/main` in `smhe00/qwerty-learner`.

## Request and delivered change

Owner authorized semantic extraction of `shortMeaning` for the Zhongkao 2027 dictionary and updating the same filename on GitHub. `public/dicts/ShanghaiZhongkao2027.json` now has that field on all 2,872 records. There are 2,865 nonempty short glosses and seven intentionally empty values listed below. `src/typings/index.ts` declares `shortMeaning?: string`; an absent or empty value means no usable short gloss.

The model authored the glosses from the existing source in seven indexed batches (0–449, 450–899, 900–1349, 1350–1799, 1800–2249, 2250–2699, 2700–2871), reviewing headword meaning and choosing concise, complete senses. This is semantic extraction, not a first-N-characters truncation or an automatic first-array-item rule. Straightforward existing definitions were reused. Long synonym lists were condensed, distinct useful senses retained, and derivatives/phrase teaching notes excluded. The same agent reviewed exceptional definitions; no independent human linguistic review is claimed.

For example, ability → 能力；才能, book → 书；预订, right → 正确的；右边；权利. Existing usage notes/bilingual examples support hear → 听到, write → 写；写作, hang → 悬挂；处绞刑, lie → 说谎；躺；位于, lose → 丢失；失去, and will → 将要；愿意；意志. No external dictionary or online runtime model service was used.

The original `trans`, `name`, phonetics, examples, offsets, tags, ordering and filename are unchanged. Even the original formatting is preserved: removing only the 2,872 inserted `shortMeaning` lines restores the exact original UTF-8 file bytes. No dictionary migration, learning-record change, synchronization change, or runtime selection/rendering change was made. No etest/master promotion belongs to this request.

## Source exceptions deliberately left empty

Indices below are zero-based JSON array indices, so duplicate headwords remain distinguishable.

| Index | Existing name | Reason |
| --- | --- | --- |
| 1808 | `at breakfast supper` | Multiple meal alternatives were concatenated into an invalid phrase. |
| 1816 | `at` | Gloss says “在周末”; example uses `at weekends`, but headword is truncated. |
| 1822 | `be` | Gloss means “意识到”; example uses `be aware of`, but headword is truncated. |
| 1830 | `be with` | Gloss/examples concern `be familiar with/to`; adjective and alternatives were lost. |
| 1834 | `be good` | Source combines “擅长于 / 不擅长于”; required `at` and contrasting phrase are missing. |
| 1858 | `by bus plane` | Transport alternatives were concatenated into an invalid phrase. |
| 2033 | `on the` | Gloss/example concerns `on one's way`, but headword is truncated. |

These require a separate source-headword correction, not a guessed short gloss. Original records were not silently renamed or deleted. Other known source contamination was excluded from new glosses: e.g. country entries carrying nationality definitions, blackboard carrying board's boarding sense, flight carrying fly's “苍蝇”, and necessary/office/pleasant carrying neighboring word definitions. Original source errors themselves remain unchanged.

Existing duplicate names were inspected and retained: at, be, poster, less, check out. Legitimate differing entries may retain differing source-specific short meanings (e.g. the two check out records); generation was indexed, not overwritten via a name-only map. In the malformed less phrase entry at index 1993, “少于 多于” was not copied verbatim; the supported lesser-quantity meaning was retained.

## Validation evidence

- Full JSON parse and coverage: 2,872 records; exactly 2,872 string fields; 2,865 nonempty / 7 intentionally empty.
- Every original field matches the execution-base JSON deeply, and all record indices/names remain in their original order.
- Removing only inserted field lines restores original bytes exactly. Git diff for the dictionary is 2,872 insertions, zero deletions.
- Nonempty gloss length: average 3.82 Unicode characters, maximum 14; no mechanical truncation. All long/multisense glosses were inspected.
- Latin-character scan: only the expected X in `X射线；X光照片`; no English examples, part-of-speech prefixes, or copied teaching notes in short meanings.
- `node --test tests/resources/dictionary-url.test.mjs tests/resources/dictionary-catalog.test.mjs`: 6 passed, 0 failed. Existing default dictionary ID and resource lookup remain intact.
- `./node_modules/.bin/eslint src/typings/index.ts`: passed.
- `git diff --check`: passed.
- Upstream fetch immediately before preparing GitHub objects: `origin/product/main` still at the execution base; no integration required. Branch update must use that exact expected SHA with force=false.

Dictionary original size: 1,497,550 bytes. Updated size: 1,599,303 bytes (+101,753 bytes, about 6.8%). Updated Git blob: `b5965a065232cee4658f2a380b26c09ad0858ed0`. Updated file SHA-256: `14959d6b5f98b8e44377cfc8324d30fc6fc15a697f8dc14bf4249f7849b86464`.

Full application/browser/Cloud gates were not rerun locally for this data-only addition and optional type declaration. No CI pass or device/UI verification is claimed for this commit. Future exercise integration must handle empty values, prevent synonymous/overlapping distractors, and use complete original definitions for detail; these short glosses alone do not certify a unique correct choice. The learning UI currently still renders `trans` and will require a separate change to use `shortMeaning`.

## Handoff

Push source and this documentation together via one non-force `product/main` ref update, then fetch and compare the published dictionary blob to the exact local blob above. Keep `edgeone-test`, `master`, `CURRENT_TASK.md` and the Circle latency task untouched. This report accompanies the source commit as a documentation follow-up; the final branch-head SHA is available in Git history.
