# Mobile subpage back-control consistency

Status: DONE in development; no production or eTest release.
Base: 6e3ef3817d1c2d4ccd6daf9cb5507aacdf37a2b6.
Validated code: **d3d2a0c743b8d5dc6663f1ebe669cc0ecda32f6e**.

## Scope

Owner asked to use the achievement page's left chevron instead of the other menu pages' visible 返回首页 text. Library, Settings, History and Data share MobilePageFrame. They and the Focus/Song mobile achievement headings now share MobileBackControl: the same 24px ChevronLeft, 1.8 stroke and borderless 44x44 hit target. Titles sit alongside the chevron with matching spacing. Labels remain available to assistive technology and hover; Link and button semantics/routes are retained. Normal menu pages remain links to /mobile; achievements retain the existing explicit onBack handler.

This is menu-page navigation only. Study exit/flush/confirmation, completion actions, guarded account/import documents, cancel actions, desktop headings, auth/storage/cloud/FSRS and award rules are unchanged. Only five mobile menu destinations are in scope. No new branch or change to the unrelated blocked Codex idle task/CURRENT_TASK.md. Existing page-scroll behavior is not changed.

## Verified evidence

Mobile Menu Completion **40183551410 / job121139464913 PASS** on the exact code SHA:
https://github.com/smhe00/qwerty-learner/actions/runs/40183551410

- **19/19 Chromium browser tests PASS**, retries=0, 1.3 minutes. All four added menu-page navigation cases passed; the original 15 menu/account/settings/phonetic/history/backup and achievement navigation cases remain passing.
- Library, Settings, History and Data: one icon-only return with retained accessible name; SVG is ChevronLeft; link remains /mobile. The achievement button uses the same SVG/control. Actual touch and keyboard returns work, including after reload.
- 320px and 900px: exactly44x44-or-larger target, left of and vertically aligned with heading, no border and no horizontal overflow. Light/dark presentation exercised.
- All six RecordDB tables, currentDict and reviewModeInfo remain exactly equal before/after navigation with synthetic learning evidence. No customer records or cloud test accounts were used.
- Focus/Song preserve their own theme, one heading, locked awards, view switch/detail close and desktop navigation. Study and guarded-account confirmation code was not modified.
- Scoped TypeScript PASS (pre-existing diagnostics outside the mobile/achievement/shared-control scope remain). Scoped ESLint zero errors/one pre-existing unused theme warning. Production bundle and mobile route-entry files PASS.

Artifact12594798965 was downloaded; ZIP SHA256 independently matched2bafea07a860e3c0262ad43673c5b9e176690192735675085a8d0a50f105ef9f. Inspected real Chromium light/dark screenshots for library/history/data and achievement. Header comparison is cropped from actual screenshots, not generated UI. The Settings screenshot inherited a nonzero scroll position from Home; it is not used as visual header evidence. Settings' independent geometry, icon, reload and actual navigation assertions passed. No claim of physical Huawei/iOS or new live-cloud validation.

## Delivery

The existing narrowly-scoped workflow covers the new shared component and four added tests. No safety assertions weakened and no explicit Cloud E2E rerun for this presentation-only change. Local Git network access failed DNS; native GitHub edits and Actions supplied execution.

Before the documentation-only completion update, main was re-read atd3d2a0c7; master remains5528f79c and eTest remains34a3d15f. Only product/main was advanced without force. No staging/production release or branch creation/deletion was performed. Other automatic CI checks are not represented as globally passing by this scoped result.
