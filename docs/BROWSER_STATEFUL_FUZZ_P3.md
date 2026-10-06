# P3 Browser Stateful Fuzzing

P3 extends Qwerty Plus verification into the real browser/React/router lifecycle.

## Required CI campaign

Review Gate runs:

```bash
P3_FUZZ_SEEDS=20 P3_FUZZ_STEPS=5 \
  yarn test:p3-fuzz
```

This is deterministic:

- seeds: 1..20
- actions per seed: 5
- total clean lifecycle actions: 100
- no probabilistic retry/pass behavior

## Exact seed replay

A failing seed is printed as:

```text
P3_BROWSER_FUZZ_FAILURE {
  "seed": 9,
  "actions": [...]
}
```

Replay only that seed:

```bash
P3_FUZZ_SEED=9 P3_FUZZ_STEPS=5 yarn test:p3-fuzz
```

The action generator is deterministic for a fixed seed and step count.

## Failure minimization

Enable browser action-sequence minimization for a reproduced failure:

```bash
P3_FUZZ_SEED=9 \
P3_FUZZ_STEPS=12 \
P3_FUZZ_MINIMIZE=1 \
yarn test:p3-fuzz
```

On failure the harness reruns candidate subsequences and prints:

```text
P3_BROWSER_FUZZ_MINIMIZED {
  "seed": ...,
  "original": ...,
  "minimized": ...,
  "actions": [...]
}
```

The minimizer is deterministic chunk-removal ddmin followed by a single-action deletion pass.

## Expanded local campaign

For broader local stress without increasing required CI duration:

```bash
P3_FUZZ_SEEDS=100 P3_FUZZ_STEPS=12 yarn test:p3-fuzz
```

## Browser actions

The seeded clean explorer currently includes:

- complete current Learn word;
- full document reload;
- desktop viewport resize;
- blur/focus lifecycle;
- SPA Typing → Learn route cycle.

After every action the harness checks browser/session invariants.

## Core invariants

- finished Learn session never renders an active word;
- Learn index does not regress for the same session;
- active Learn word requires an unfinished session on `/learn/session`;
- non-typing lifecycle actions cannot create post-finish evidence;
- desktop resize is presentation-only;
- blur/focus preserves Learn progress;
- clean route/reload eventually converges durable IndexedDB state forward.

## Deterministic test hooks

Production code contains two narrow gates and two fault switches used only when the Playwright harness explicitly creates:

```text
window.__QWERTY_P3_TEST_HOOKS__
```

Normal production never creates this object, so the hooks are inert.

Gates:

- `learn-preparation`
- `review-persistence`

Injected faults:

- `stale-preparation-owns-navigation`
- `desktop-resize-navigates-root`

These exist to prove the browser detector can kill the intended lifecycle fault, not merely pass clean flows.

## P3 closure of Coverage Review 3.0 gaps

### Stale async preparation wins navigation

P3 blocks Learn preparation, performs an SPA route leave, then releases the blocked operation.

Clean ownership must suppress the stale completion.

An injected stale-owner mutant deliberately ignores ownership and is detected because it steals the route back to `/learn/session`.

### Route-cache / IndexedDB divergence around crash/reload

P3 blocks real ReviewRecord persistence after synchronous route-cache state advances.

Observed controlled divergence in CI:

```text
route index   = 1
durable index = 0
```

The page is reloaded while the old document still owns the blocked write. The new document must restore index 1 from route-critical cache, and the next durable checkpoint must converge forward.

### Refresh during checkpoint commit

The same controlled persistence gate creates a deterministic refresh-in-flight window without arbitrary sleeps.

### Viewport resize

Resize is a first-class seeded action.

Clean behavior requires pathname stability.

The injected historical mutant forces desktop resize through root navigation; the browser invariant detects the route change while terminal data remains protected.

## Scope limits

P3 is still bounded verification, not an exhaustive browser-state proof.

It does not enumerate every possible browser scheduler interleaving, OS sleep/wake behavior, storage-engine crash implementation, or audio-stack failure.

The important change is that the four previously explicit P2 partial lifecycle classes now have deterministic real-browser reproductions and detector contracts.
