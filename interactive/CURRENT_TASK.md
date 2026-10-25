---
protocol_version: '1.1'
task_id: 'IDLE-ACCOUNT-ACTIVATION-20261025'
task_file: 'interactive/tasks/IDLE-ACCOUNT-ACTIVATION-20261025.md'
report_file: 'interactive/reports/IDLE-ACCOUNT-ACTIVATION-20261025-report.md'
target_branch: 'product/main'
status: 'BLOCKED'
executor: 'Codex (single activation executor)'
claim_base_commit: 'c74a59b8f9c1972a2c159a082b8fc04519cfa2c8'
release_to_master: false
runtime_activation_authorized: true
---

Latest owner preference: do NOT require a new API Token. Resume basef91a4ac6
preserves independent session-handoff/mobile/learning work. The new control-
plane token was an automation choice, not a runtime dependency. Gateway Blob
access uses existing platform authorization. Prefer manual China-console
configuration of the two IDLE settings plus ordinary app-route/browser
verification. Operations doc now provides exact preparation/on/rollback steps.
Status remains BLOCKED only pending that actual test configuration/verification,
not pending a mandatory GitHub Secret. Do not ask the user to create one again.
API read success does not establish the owner's historical console usage;
both sites are China-console sites as the owner confirmed.

Historical SDK-path checkpoint (superseded as a required access method):

Owner already authorized activation and verification. Do not ask again.
Production NOT enabled: q.smhe.cn/master5528f79c, policy.enabled=false.
Staging t.smhe.cn/edgeone-test5fa7574, policy disabled; read-only ABI probe
confirms IDLE date absent in context and Node, region ap-hongkong.

Isolated real Blob lifecycle40159814798 PASS8/8,69 keys gone; current-site
project binding was NOT established by that run. Corrected exact-ID and
DescribePagesEnvironments audit40167108988 sees2 global projects but neither
current domain; China API returns109/authentication error with existing CI
credential. Cloud workspace itself has no secrets. No more blind env writes.

Original temporary metadata has been FULLY restored to original absence:
40167226920 PASS at31285e80,2 exact owned records removed, remaining0.
Scoped contracts4/4, binding/scope9/9, read-only probe2/2 passed. Frontend/ordinary
staging browser and V4 transport passed; readiness40166505577 failed and
actual enabled maintenance journey is still outstanding. No production change
or real-account deletion. Historical reports and all failed runs retained.

Next: identify correct site account/region/project/environment via supported
private access. Owner has now CONFIRMED BOTH sites use the CHINA console.
New verification clients pin region=china and stop on authentication failure;
never auto-fallback to global. Existing CI token previously returned109.
China-only CI40171181067 at8dc5e16c reproduced109 at project-list; scope
contracts PASS12/12 and all Blob writes were SKIPPED. China workflows now use
dedicated repository secret EDGEONE_CHINA_API_TOKEN (internal env name remains
EDGEONE_API_TOKEN). Historical international credential/rollback is separate.
Dedicated-credential CI40171408799 at43e388b7 now confirms
ci-credential-missing at credential-check, before any API project read/write;
scope contracts PASS12/12, real Blob job SKIPPED. Obtain the credential through private GitHub
Secrets/connection, never chat. See operations doc for the concrete location.
Resume execution base969077f2 includes independent mobile UI work; preserve it.
No further region question is needed. Never solicit
secrets in chat. SDK Project normalization omits custom domains; raw reads must
use Filters and find the exact returned ProjectId. Inspect official environment
records as needed, not only legacy Project.CustomDomains. Then run reversible
staging enabled path/rollback before production settings and required gates.
Read-only staging ABI route is temporary pending this diagnosis. Circle PR17
remains postponed. Full chronological evidence and instructions in linked report.
