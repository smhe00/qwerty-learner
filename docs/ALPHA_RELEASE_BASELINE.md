# Learn Alpha 1 Release Baseline

> Product version: `0.2.0-alpha.1`
>
> Release name: **Qwerty Plus — Learn Alpha 1**
>
> Canonical integrated branch: `product/main`
>
> Customer guide: [ALPHA_CUSTOMER_GUIDE_ZH.md](./ALPHA_CUSTOMER_GUIDE_ZH.md)

## 1. Purpose

This release establishes a clean, auditable baseline for controlled Alpha use.

The goal is not to freeze learning research. The goal is to make sure every
real-user observation starts from a version whose:

- code behavior is bounded and verified;
- policy versions are identifiable;
- customer documentation matches the running product;
- historical design documents are not confused with active contracts;
- cloud-data limitations are stated accurately.

## 2. Active learning stack

### Product modes

```text
Typing
Learn
```

Typing remains the upstream-style chapter/input practice mode.

Learn owns long-term Acquisition and due Review.

### Acquisition

```text
Exposure
→ Supported
→ Independent
→ Complete / Deferred
```

Durable admission requires clean, unaided, spacing-valid Independent evidence.

### Active control policies

| Controller | Active version |
|---|---|
| Interaction Strain | `learn-interaction-strain-v2` |
| Dynamic Scaffold | `learn-dynamic-scaffold-v1.1` |
| Recovery Window | `learn-recovery-window-v1` |
| Acquisition quota | `learn-acquisition-quota-v3` |
| Daily plan | `learn-daily-plan-v1` |
| Acquisition flow | flow version 1 |
| Active scheduler | `basic-v2` |
| FSRS | shadow / analysis only, no write authority |

## 3. Stability contract

The Alpha baseline includes a dedicated Learn Control Stability Gate.

Required properties include:

- bounded EWMA observer;
- hysteresis/no-chatter around strain mode boundaries;
- finite Acquisition termination;
- bounded non-recursive Recovery Window;
- quota saturation;
- due-first backlog behavior;
- closed-loop virtual-learner regression;
- efficiency envelope preventing stability by excessive scaffolding.

The control system is therefore intentionally constrained.

This does **not** claim universal or mathematically global optimality for real
learners. Real Alpha data is required to validate long-term learning efficiency.

## 4. Default Alpha dictionary

```text
id: hujiaoxin2027
name: 沪教新初2027
entries: 1751
```

The application still supports the broader upstream dictionary catalog.

## 5. Data and cloud contract

Local working data remains in browser IndexedDB.

Current backup/sync write format:

```text
qwerty-backup-v3
```

Legacy compatible restore format:

```text
qwerty-dexie-gzip-v2
```

Current cloud sync:

- optional;
- manual upload/download;
- revision-conflict protected;
- single-current-session account model;
- not automatic record-level merge;
- **not client-side/end-to-end encrypted**.

Customer-facing details are maintained in
`CLOUD_SYNC_USER_GUIDE.md`.

## 6. Platform scope

Alpha learning validation is desktop-first.

The automated browser release baseline uses Chrome. Desktop Chrome / Edge are
the recommended Alpha clients.

The current mobile route is primarily a product-introduction surface rather
than the full Learn Alpha workflow.

## 7. Known Alpha limitations

Not active in this release:

- automatic per-user Personal Calibration;
- FSRS-6 write authority;
- online automatic controller-parameter learning;
- automatic multi-device record-level merge;
- client-side E2EE cloud snapshots;
- full mobile Learn parity.

These are deliberate boundaries, not hidden missing features.

## 8. Documentation authority

Current documentation order:

```text
running code
→ current product/control contracts
→ customer/user guides
→ historical development plans
```

Canonical index:

`docs/README.md`

Historical plans remain in the repository for traceability and are explicitly
marked or indexed as historical.

## 9. Release gates

A publishable Alpha baseline must pass on the final release SHA:

### Review Gate

- lint;
- domain tests;
- formal model checker;
- Learn Control Stability Gate;
- Typing audio formal;
- FSRS shadow/G3 tests;
- Typing lifecycle browser gate;
- production build;
- production navigation smoke;
- multi-word Learn/Review browser gate.

### Cloud release validation

Cloud-related changes must continue to satisfy the repository's Cloud Sync
Gate and production/live acceptance rules before the production pointer is
promoted.

## 10. Promotion rule

Product development remains:

```text
feature/release branch
→ verified product/main
→ production pointer fast-forward only
→ deployment acceptance
```

Do not place independent product commits on the production pointer.

## 11. Exact release identity

Release tag:

```text
learn-alpha-v0.2.0-alpha.1
```

The tag target is the exact immutable release commit. The document intentionally
does not embed its own Git SHA because doing so would make the release document
self-referential and change the SHA on every update.

The tag may be created only after Review Gate, Cloud Sync Gate and FSRS Phase G
Gate are green on the final `product/main` commit.

Creating the tag establishes the source-code Alpha baseline; production
promotion remains a separate fast-forward/deployment acceptance action.
