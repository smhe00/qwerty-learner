# Staging UI restoration after independent release

Status: VALIDATED LOCALLY; independent production 98697131 is deployed and verified (40274648581). Ready for product/main CI/Pages, then authorized restoration to etest only.

## Sources preserved

- Production candidate base: 98697131d09393a479f30da9eb9b117e8117a0e7.
- Existing PC sync menu / mobile quick-sync UI: d34ba238e62bb89afc2447f81f2307bede259250.
- Account direct-entry task: implementation 3e869a2d, development/report head b98364ad. Its task file and AccountTools changes are restored along with its tests.
- Keep all release diagnostics and startup fixes; no cloud transaction, lease, migration, ownership, admin authorization or server policy changes in this restoration.

## Behavioral integration

A signed-in PC account name/avatar opens the guarded account document directly. A separate 44px arrow opens the existing sync menu; it supports keyboard Enter/Escape and retains focus. This preserves the direct-entry request without removing the existing quick-sync menu. Anonymous PC entry and mobile account entry also go directly to the guarded account page. The mobile sync button and completion/return notice are restored. Cloud tools remain a separate explicit settings entry.

The first integration run found that the old menu toggle deliberately blurred itself, so Escape no longer reached the menu. The restored toggle keeps keyboard focus; all four signed-in desktop variants now pass. This UI-only correction stays on the staging restoration branch.

## Local validation

- Account continuity and combined menu behavior: 15/15 PASS, real Chromium, native/fallback writer lease, anonymous/valid/expired accounts, immutable credentials/learning rows, competing tab refused; includes mobile sync visibility and expired disablement.
- Desktop/mobile account, registration, returns and writer flows: 22/22 PASS.
- Quick-sync contract: 7/7 PASS.
- Pages account preview: 4/4 PASS, cloud disabled, basename/legacy data preserved.
- EdgeOne-mode build: PASS (26.48s). Pages build: PASS.
- Scoped lint: 0 errors, 4 existing warnings (three non-null assertions in guarded entry and Learn effect cleanup reference). git diff --check PASS.
- Temporary dynamic-port continuity config initially used the config directory as cwd; it was corrected before browser execution. This was local harness setup, not an application failure.

Actual staging promotion and production version evidence are recorded in COMMIT-OUTCOME-INDEPENDENT-RELEASE-20261026-report.md. Do not claim this UI candidate is the independent production release.
