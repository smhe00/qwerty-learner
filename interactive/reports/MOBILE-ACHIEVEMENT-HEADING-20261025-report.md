# Mobile achievement heading refinement

Status: DONE in development; no production or eTest promotion.
Execution base: 2db6550578b4d82631b6bd349bc8b72b4080fe5a.
Validated code: **9824cc65e3dcf017658b21a4d16398c0831a547a**.

## Owner feedback and correction

The previous single-return fix removed one button but left a beige brand/navigation shell above a second QWERTY/title header, with a boxed return action detached from the title. This refinement supersedes that mobile heading composition, not its data/navigation safety requirements.

Remove the mobile wrapper/header rather than hide individual duplicate labels. Both collection views now use a page-integrated MobileAchievementHeading: a left chevron with a 44px hit target alongside one h1 and one description. Mobile subpage headings do not repeat the Home brand. Focus/Song retain their own continuous theme background. Song displays its real unlocked count in the same heading. Mobile returns directly to /mobile; desktop callers, branded headers and standalone return remain unchanged. View switching and detail close are separate, retained actions.

## Validation evidence

Mobile Menu Completion **40182566026 / job121136523328 PASS**, exact code SHA above:
https://github.com/smhe00/qwerty-learner/actions/runs/40182566026

- **15/15 browser checks PASS, retries=0, 54.7s**, including expanded mobile Focus, mobile Song and desktop navigation cases.
- Exactly one header/h1/page return. No duplicate QWERTY header or former outer brand. The back action is left of and vertically aligned with the title, borderless and at least44x44px. Verified320px/900px, rotation, reload and legacy narrow /achievements; no horizontal overflow.
- Both views preserve34 locked cards. View switching, sample-detail close and return preserve all six tables, dictionary and review checkpoint exactly in synthetic profiles.
- Desktop Focus/Song retain their original branded headings and Learn return; no mobile heading is mounted on desktop standalone routes.
- Existing menu/settings/history/backup/phonetic/account checks also passed. Scoped TypeScript PASS; pre-existing diagnostics elsewhere remain. Scoped lint has zero errors and one pre-existing unused CollectionCard theme warning. Production bundle and mobile route entries build successfully.
- Real Chromium screenshots downloaded from artifact12595225625; ZIP SHA256 independently matches4e594a73dcd3cac0cfd7d2480859edebb3de41c91dc16782a05c155eb8a3af1f. Visually inspected Focus/Song light and dark images: one integrated heading, no outer cream/blue frame stack and no duplicate branding. Focus dark screenshot exercises theme tokens without persisting a preference; Song uses its existing night-view action. This is not a physical Huawei/iOS certification or a new real-cloud acceptance.

Screenshot names: achievement-unified-heading-focus.png, achievement-unified-heading-focus-dark.png, achievement-unified-heading-song.png, achievement-unified-heading-song-dark.png.

## Scope and coordination

Changes are confined to achievement presentation, router composition, affected tests and scoped validation. No authentication, schema, storage, cloud/FSRS/award rule, idle cleanup or customer-data change. No new branch. The unrelated blocked Codex idle task and CURRENT_TASK.md are intact. Local Git network access failed DNS; GitHub-native writes and Actions supplied source and validation. No local test success is claimed.

Re-read product/main at9824cc65 before this documentation-only completion update. This task did not advance master or edgeone-test, create cloud accounts, or delete any branches. Other automatic CI runs are not represented as all-green by this scoped result.
