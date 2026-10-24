# Mobile menu completion

Owner instruction: 执行 — connect achievements, fix US/UK phonetic display, add mobile history and sync/backup management with meaningful regression coverage. No master release is authorized by this task.

Base: dcb11229e06665b7949021c2115112b199b78181. Dedicated executor: ChatGPT. Branch: feat/mobile-menu-completion-20261024. Existing Codex mobile HTTP/account task is DONE; do not reopen or change its lock, credential or cloud-data protocols.

Implementation uses active RecordDB reads for history; no account vault enumeration, record changes, migration, deduplication or scheduler writes. Reuse existing Backup V4 download/inspect and pre-mount import/cloud transactions. Account icon retains the established overlay. Mobile tool navigation uses same-origin full-document replace and Pages basename. Destructive import remains behind its existing explicit confirmation. No password reset/recovery or account deletion is added.

The exact-context integration script is a construction aid only; it is not part of the runtime. A branch-only workflow applies it, validates scoped source/build and functional browser cases, and commits only the tested presentation edits to the isolated branch without force. Review the resulting source diff before product/main integration; check upstream for concurrent owner edits. No etest promotion solely for UI validation, no real cloud account creation, no master change.

Required: all visible menu entries work; 320px and dark layout; date/dictionary counts are honest and reads do not change six tables/current dictionary; read errors are not empty history; export/valid+invalid inspection preserve data; cloud metadata inspection makes only GET; tool handoff uses guarded documents; US voice renders US phonetic and absent accents are labeled. Existing Mobile home and settings/library checks retained and updated from two placeholders to zero.
