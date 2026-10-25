# Mobile achievement heading refinement

Status: IMPLEMENTED; validation pending. No production or eTest promotion.
Execution base: 2db6550578b4d82631b6bd349bc8b72b4080fe5a.

Owner rejected the previous single-return screenshot: removing one button still left a beige brand/navigation shell above a second QWERTY/title header, and a boxed return action detached from the title.

Remove the mobile wrapper/header rather than hide individual duplicate labels. The two collection views now share a page-integrated MobileAchievementHeading: a left chevron with a 44px hit target alongside a single h1 and one description. Mobile subpage headings do not repeat the Home brand. Focus/Song retain their own continuous theme background. Song displays its real unlocked count in the same heading. Mobile navigation returns directly to /mobile even if old desktop background state is present; desktop callers and standalone return remain unchanged.

Regression plan: exactly one header/h1/page return; no QWERTY heading or outer brand; return is left of and vertically aligned with title, borderless and at least 44x44; 320px/900px with no horizontal overflow, reload/legacy mobile URL, Focus/Song switching and detail close. Retain all 34 locked cards and exact six-table/dictionary/checkpoint evidence. Capture actual light/dark screenshots (Focus dark token exercise is presentation-only, not a preference persistence test). Existing desktop branded headings and return are checked explicitly.

Changes are confined to achievement presentation, router composition, affected tests and scoped validation. No authentication, schema, storage, cloud/FSRS/award rule, idle cleanup or customer-data change. No new branch. The unrelated blocked Codex idle task is left intact. Local Git network access fails DNS, so repository edits and CI validation use the GitHub connector; no local execution success is claimed.
