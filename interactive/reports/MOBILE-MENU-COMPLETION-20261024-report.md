# Mobile menu completion checkpoint

IN_PROGRESS. Baseline product/main dcb11229e06665b7949021c2115112b199b78181. Isolated branch feat/mobile-menu-completion-20261024. No master/etest promotion or existing user data changes.

Implemented read-only mobile history, completed menu links, reused V4 backup and guarded sync/import entry points, and pronunciation-aware exposure phonetics. No data, FSRS, auth, ownership, or writer-lock protocol change.

Run 40109635899: scoped lint/build PASS, 10/11 focused tests PASS. Failure was a synthetic phonetic fixture seeded at independent recall, which correctly does not show answer phonetics. Retained trace; corrected fixture to exposure and exercised both real UK/US settings via router navigation so init-script seeding cannot mask persisted choice.

Run 40110410149 (construction candidate from 3f2de27a): scoped TypeScript, lint/build and 11/11 focused tests PASS. Synthetic screenshots reviewed at 320px; history dark and data backup view fit without horizontal overflow. Six-table/current dictionary/checkpoint snapshots remain identical before/after history viewing, backup validation, and mocked read-only cloud inspection. Normal and invalid gzip validation included.

Actual tested source is now committed as normal files, not applied during tests. Add the existing two-account-entry test for the revised menu -> data -> manage-account flow, preserving all prior assertions. Final committed-source acceptance pending.

Limits: Chromium mobile viewport/touch simulation, no physical handset/iOS certification. Cloud inspection and transaction handoff are mocked; this UI validation does not certify real multi-device cloud convergence. Import uses the existing guarded transaction and explicit confirmation; no destructive restore/new live cloud write performed. Whole-project TypeScript has pre-existing unrelated diagnostics; only changed source scope is clean.
