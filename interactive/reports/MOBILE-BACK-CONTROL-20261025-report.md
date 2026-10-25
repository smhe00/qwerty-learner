# Mobile subpage back-control consistency

Status: IMPLEMENTED / scoped CI pending. No production or eTest release.
Base: 6e3ef3817d1c2d4ccd6daf9cb5507aacdf37a2b6.

Owner asked to use the achievement page's left chevron instead of the other menu pages' visible 返回首页 text. Library, Settings, History and Data share MobilePageFrame. They and the Focus/Song mobile achievement headings now share MobileBackControl: the same 24px ChevronLeft, 1.8 stroke and borderless 44x44 hit target. Titles sit alongside the chevron with matching spacing. Labels remain available to assistive technology and hover; Link and button semantics/routes are retained. Normal menu pages remain links to /mobile; achievements retain the existing explicit onBack handler.

This is menu-page navigation only. Study exit/flush/confirmation, completion actions, guarded account/import documents, cancel actions, desktop headings, auth/storage/cloud/FSRS and award rules are unchanged. Only five mobile menu destinations are in scope. No new branch or change to the unrelated blocked Codex idle task/CURRENT_TASK.md.

Validation: four new browser cases exercise all ordinary menu pages, actual touch/keyboard return, empty visible label with accessible name, shared SVG, 44px size/alignment, 320px/900px, light/dark screenshots, reload and exact six-table/currentDict/reviewModeInfo preservation. Retain existing mobile achievement Focus/Song/desktop checks and other menu tests. Extend existing narrowly-scoped workflow to cover the shared component; do not weaken assertions or trigger explicit Cloud E2E for a visual change.

Local Git network access fails DNS; native GitHub edits and Actions provide execution. Do not claim passing validation until logs are read.
