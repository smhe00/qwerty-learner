# Administrator direct login
Status: IN_PROGRESS. Executor: Codex-admin-direct-login. Base: 1bd2c356b46616bf36ee94a8e794914f2ffd780b.

Owner requests fixed admin login using ADMIN_PASSWORD without registration, and explicit protection from 180-day idle deletion. Independent task; leave the Circle executor CURRENT_TASK untouched.

Reuse existing immutable administrator identity and legacy storage keys; expose admin publicly. Initialize only after a correct configured password on actual login. No embedded default, no name-only privilege, no overwrite of conflicting identities, no initialization from preflight. Preserve sessions, password rotation and account protection. Protect both admin and legacy smhe from cleanup, even before binding/configuration is available.

Validate synthetic gateway login, permissions, wrong/missing configuration, legacy adoption, identity conflicts, lost receipts/concurrency, session rotation, read-only preflight, and repeated destructive idle runs with administrator data. Scoped lint and relevant Cloud contracts. Commit/push product/main only. No etest/master promotion; live feedback acceptance remains paused awaiting human admin setup/login.
