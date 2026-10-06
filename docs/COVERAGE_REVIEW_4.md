# Coverage Review 4.0 — Browser-Stateful Verification

## Executive result

P3 closes the four lifecycle/timing gaps left partial by Coverage Review 3.0.

Catalog source of truth:

```text
tests/simulation/fault-catalog.ts
catalog version = 2
```

Measured catalog disposition:

```text
catalog total                  42
covered                        42
partial                         0
uncovered                       0
out-of-scope                    0

executable critical mutations  29
killed                          29
critical mutation kill rate    100%

clean mutation controls         11
false positives                  0
```

Important limitation:

**42/42 covered is coverage of the declared catalog, not a proof that all possible browser/product failures are enumerated.**

## P3 browser campaign

Required CI campaign:

```text
seeds          20
steps/seed      5
clean actions 100
clean failures  0
```

Actions are deterministic for each seed and include:

- complete current Learn word;
- document reload;
- desktop viewport resize;
- blur/focus;
- SPA Typing → Learn route cycle.

Failures print the exact seed and ordered action sequence.

Exact replay:

```bash
P3_FUZZ_SEED=<seed> P3_FUZZ_STEPS=<steps> yarn test:p3-fuzz
```

Optional failure minimization:

```bash
P3_FUZZ_SEED=<seed> \
P3_FUZZ_STEPS=<steps> \
P3_FUZZ_MINIMIZE=1 \
yarn test:p3-fuzz
```

## Gap 1 — stale async preparation wins navigation

### Previous state

Partial.

Unit/domain ownership guards existed, but arbitrary real SPA route timing was not exercised in-browser.

### P3 detector

A deterministic browser gate pauses Learn preparation.

The test then:

```text
Learn preparation starts
→ preparation blocks
→ SPA navigates to Typing
→ blocked preparation releases
```

Clean behavior:

- stale preparation does not own navigation.

Injected mutant:

```text
stale-preparation-owns-navigation
```

The mutant deliberately ignores current route/ownership and steals navigation back to `/learn/session`.

Browser invariant detects it.

### Final status

**Covered.**

## Gap 2 — route-cache / IndexedDB divergence around crash/reload

### Previous state

Partial.

The architecture intentionally writes route-critical localStorage synchronously and IndexedDB asynchronously, but the real browser crash/reload window was not deterministic in CI.

### P3 controlled window

A test-only persistence gate blocks the actual ReviewRecord IndexedDB write after the synchronous route cache has advanced.

Observed CI evidence:

```text
route-cache index = 1
IndexedDB index   = 0
```

Then:

```text
blocked durable write
→ full page reload destroys old document
→ new document restores route-critical index 1
→ persistence gate releases
→ next checkpoint converges IndexedDB forward
```

This verifies the intended precedence and recovery behavior under a real document lifecycle.

### Final status

**Covered.**

## Gap 3 — refresh during checkpoint commit window

### Previous state

Partial.

Simulation/formal models covered stale ordering, but not real browser teardown during the in-flight persistence window.

### P3 detector

The same deterministic persistence gate creates the real timing window without arbitrary sleeps.

The page is reloaded while the old document owns a blocked checkpoint.

Invariant:

- route progress must not regress;
- next durable checkpoint must converge forward;
- no terminal resurrection.

### Final status

**Covered.**

## Gap 4 — viewport resize without document reload

### Previous state

Partial.

A specific historical regression existed, but resize was not a first-class seeded browser action.

### P3 clean behavior

Desktop resize is now part of every broader fuzz campaign distribution.

Invariant:

```text
desktop resize
=> pathname unchanged
```

### P3 injected mutant

```text
desktop-resize-navigates-root
```

The historical bad behavior is deliberately reintroduced under test hooks.

The P3 browser invariant detects the navigation change.

Terminal data protection is separately verified: even under the mutant, a finished session cannot resurrect an active word.

### Final status

**Covered.**

## Stateful invariants checked after browser actions

The browser harness checks:

- same-session persisted index never regresses;
- finished session never renders an active word;
- active Learn word requires unfinished Learn state on `/learn/session`;
- post-finish non-typing lifecycle actions cannot create new WordRecord evidence;
- desktop resize does not navigate;
- blur/focus preserves progress;
- clean reload/route cycles converge durable state forward.

## Test-hook design

Test hooks exist in:

```text
src/dev/browser-fuzz-hooks.ts
```

They are inert unless the test explicitly creates:

```text
window.__QWERTY_P3_TEST_HOOKS__
```

Gates:

- `learn-preparation`
- `review-persistence`

Injected faults:

- `stale-preparation-owns-navigation`
- `desktop-resize-navigates-root`

No normal production path creates the global object.

## One false-positive found while building P3

The first clean campaign failed reproducibly at seed 9:

```text
complete-current
→ blur/focus
→ complete-current
```

Investigation showed the test helper recognized only:

```text
按任意键开始
```

while correct product behavior after blur is:

```text
按任意键继续
```

The product was correct; the fuzzer action model was wrong.

P3 corrected the helper and also requires a completed word to reach both:

- durable progress;
- settled next-word UI.

This prevents legal success-feedback lock windows from becoming false bugs.

This is an important property of P3: **the fuzzer itself is treated as software that must be validated, not as an unquestioned oracle.**

## Current verification stack

```text
P0  field replay + minimization
P1  production-aligned virtual Learn model
P2  critical fault catalog + mutation coverage
P3  deterministic browser stateful fuzz
```

The loop is now:

```text
field incident
→ P0 structural replay/minimize
→ P1 deterministic model seed
→ P2 fault class / mutation contract
→ P3 real-browser lifecycle attack
```

## CI result

Final P3 candidate:

```text
Review Gate       37421422769  PASS
Achievement Gate  37421422753  PASS
Cloud Sync Gate   37421422752  PASS
FSRS Phase G      37421422832  PASS
```

P3 browser gate itself:

```text
action minimizer                      PASS
20-seed clean browser fuzz            PASS
stale preparation mutant              PASS (detected)
route-cache/IndexedDB divergence      PASS
refresh checkpoint window             PASS
desktop resize mutant                 PASS (detected)
```

## Remaining epistemic limits

Catalog status is now fully covered, but verification remains bounded.

Not exhaustively enumerated:

- every Chrome task/microtask scheduling permutation;
- OS sleep/wake and process suspension;
- browser storage-engine corruption;
- arbitrary network/CDN chunk failures;
- all audio device/browser implementation failures;
- every possible future feature interaction.

Future coverage review must add new fault catalog entries when new hazard classes are identified rather than treating catalog version 2 as closed forever.
