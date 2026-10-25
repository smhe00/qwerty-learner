---
task_id: IDLE-ACCOUNT-ACTIVATION-20261025
status: IN_PROGRESS
target_branch: product/main
base_commit: c74a59b8f9c1972a2c159a082b8fc04519cfa2c8
allow_parallel_executors: false
release_to_master: true
runtime_activation_authorized: true
report_file: interactive/reports/IDLE-ACCOUNT-ACTIVATION-20261025-report.md
---

# Enable idle cleanup after actual deployed-path verification

## Latest owner correction — implement code-managed activation

Owner explicitly instructed “你应该修改代码，让代码运行”, rejecting manual
console configuration as the task. Implement code deployment activation with
no new API Token/secret/control-plane login. This supersedes our earlier local
restriction against source-managed activation and manual-console resume steps.
Normal release authorization already exists; keep all same-SHA release gates.

Release policy defaults automatic execution on; first executing independent
maintenance persists its own per-project UTC activation in existing Blob with
conditional creation/canonical confirmation. Existing accounts receive full
180 days from that floor. Login/public policy/preview never initialize it;
preview is read-only. Deployments never intentionally rewrite it; invalid or
unconfirmed metadata holds deletion. Explicit environment stop remains an
optional override; source enabled=false provides normal code rollback. Keep
identity-last deletion, daily best effort, bounded work, return cancellation,
admin/SMHE exemption, Circle holds and local-data preservation.

Validate automatic boundary/restarts/failed init/lost ACK/overlap/read-only
preview/source and env stops; existing backend/storage/auth safety contracts;
no-control-plane actual staging login/learning/maintenance path with synthetic
accounts and verified cleanup. Then same-SHA published Pages/etest/release-ready
before authorized production promotion. Never age real accounts or add a public
clock endpoint. Do not re-ask user authorization or delegate console setup.

Historical SDK/manual-console investigation follows for audit only.

Owner authorized activation and then instructed “那你自己可以开始验证吧”.
Authorization persists; do not ask again. Scope includes isolated synthetic
Blob fixtures, necessary normal staging rebuilds/reversible settings and a
read-only binding diagnostic route. No public clock/mutation test API, aged
customer fixture, production branch bypass, owner password read or Circle work.
Production advancement, if needed, retains existing same-SHA Pages/etest/
release-ready gates. This phase does not skip them.

## Latest confirmed state

- Production q.smhe.cn/master5528f79c, policy disabled; never activated here.
- Staging t.smhe.cn/edgeone-test5fa7574, execution disabled; both context and
  Node lack the date. Runtime diagnostic only emits booleans/types/known region.
- Actual isolated Blob8/8 and69-key cleanup succeeded40159814798. This is an
  accessible historical project, not qualified current-domain correspondence.
- Exact-ID and official environment read audit40167108988 sees2 global
  projects, neither reports current-domain bindings. China API109 rejects the
  existing credential as authentication-related. No ready local secret binding.
- All original temporary settings restored to original absence by40167226920,
  exact owned2 records removed/0 remain; no production mutation or deployment.
- New Node20 binding/scope9/9, probe2/2 and original metadata guards4/4 pass.
  Actual enabled browser maintenance + runtime rollback remain outstanding;
  ordinary staging browser/V4 jobs passing do not prove that path. Preserve
  release-readiness failure40166505577 and earlier failed attempts.

## Resume steps — preferred without a new API Token

Owner questioned the new token requirement and prefers avoiding it. The token
is needed only by our optional remote console/SDK automation, not by cleanup
runtime. Do not ask for a new GitHub Secret as a prerequisite. Both sites are
on the China console; earlier global API observations do not establish the
owner's historical use of the international site.

1. Use the owner's ordinary China console session to identify the actual
   t.smhe.cn project/environment and deployment branch. Follow the concrete
   console-only steps in docs/operations/IDLE_ACCOUNT_CLEANUP.md. Record original
   values/absence of only the two IDLE settings; keep other secrets private.
2. Prepare a fresh actual UTC activation floor with execute=false on staging,
   normal redeployment, and anonymous source/policy checks. Then enable staging
   execution for independent authenticated maintenance/browser qualification.
   No new control-plane token, public clock API, aged customer fixture or owner
   password request. Existing Blob access uses the platform's authorization.
3. Test the actual deployed enabled path, responsiveness and recovery boundaries;
   preserve all existing qualification requirements and coverage limitations.
   Restore exact test settings including absence, redeploy, and prove runtime
   off. Console/operator changes need no new permission; activation is authorized.
4. After qualification and applicable same-SHA release gates, configure actual
   production with fixed fresh UTC start and execution=true through the console.
   Never backdate; preserve the180-day floor, SMHE/admin exemption, local data
   and no-cron design. Verify effective state and normal administrator preview
   through authorized access; never guess passwords or revoke owner sessions.
5. Production rollback sets execution=false while retaining its fixed date,
   followed by normal redeployment/runtime proof. Remove the temporary read-only
   diagnostic when no longer needed. Retain all prior failure evidence.

Optional SDK automation still pins region=china and refuses global fallback.
Its missing credential blocks only that optional route. The next actual
blocked step is manual test-project configuration/deployment, not creation of
an API Token. No runtime settings changed in this documentation correction.
