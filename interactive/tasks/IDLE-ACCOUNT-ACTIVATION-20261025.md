---
task_id: IDLE-ACCOUNT-ACTIVATION-20261025
status: IN_PROGRESS
target_branch: product/main
base_commit: c74a59b8f9c1972a2c159a082b8fc04519cfa2c8
allow_parallel_executors: false
release_to_master: false
runtime_activation_authorized: true
report_file: interactive/reports/IDLE-ACCOUNT-ACTIVATION-20261025-report.md
---

# Enable production idle cleanup after remaining qualification

Owner instruction: “那现在可以启动吧，也没有什么其他需要验证的了，对吧？”
This authorizes activation; do not ask for the same permission again. Explain
the actual outstanding verification/access instead of promising it is complete.
The previous application release remains complete at REVIEW.

Owner explicitly instructed starting the verification. Implement and run an
isolated SDK qualification through Actions' existing private credential binding;
do not treat inability to list secret names as inability to use a configured
workflow credential. Exact read-only staging discovery must precede any write.
No Maker promotion or new public clock/test endpoint is authorized or needed.

Verification continuation: real SDK lifecycle suite2543911e passed8/8 with all
69 tracked keys confirmed absent. Next qualify the actual deployed staging
login/learning/maintenance path with a reversible temporary configuration of
only the two IDLE settings. Fresh UTC activation time gives every staging
account a full180-day floor; no aged real account. Snapshot before mutation,
keep unrelated/administrator values private and untouched, restore exact old
values even after failure, and verify runtime policy disabled again. No
production configuration change or Maker deployment in this phase. The user
already authorized verification; do not add another confirmation step.

## Blockers

- Production https://q.smhe.cn; existing application5528f79c. No application
  change, master push, Circle work or scheduler is required for activation.
- No ready Tencent/EdgeOne control-plane credential or tool is available.
  GitHub integration also returned403 for secret/variable name metadata;
  that does not establish whether secrets exist. Do not extract credentials
  or ask for passwords/API secrets in chat.
- Local/fake-store cleanup tests passed previously. Operations instructions
  still require actual isolated Blob interruption/convergence qualification
  before enabling production deletion. Ordinary V4 deletion smoke does not
  establish the automatic idle-deletion lifecycle.

## Continue when controlled access is available

1. Qualify the idle lifecycle on isolated nonproduction Blob with synthetic
   identities and injected test clock:180-day boundary, drain/cancel,
   interruption/retry, overlapping invocations/listing convergence, exact
   namespace isolation, identity removed last, admin/SMHE/Circle holds. Keep
   aged fixtures/clock overrides out of production; record regional coverage.
2. Check administrator protection and a redacted read-only production preview
   using the operator's normal session. Do not guess the bootstrap password
   or revoke the owner's session for probing.
3. Set production EdgeOne **runtime** IDLE_POLICY_START_AT to the actual fixed
   UTC activation time; after qualification set IDLE_CLEANUP_EXECUTE=true.
   No VITE settings, source-default changes or scheduler. Never backdate.
   Existing accounts get a full180 days from activation; later activity extends it.
4. Apply normal provider configuration activation. Verify canonical health,
   public policy enabled=true/180 days, and administrator dry-run
   executionEnabled=true with no currently eligible accounts under the new
   floor. Verify independent maintenance leaves login/learning responsive.
   Never force a customer account eligible to demonstrate deletion.
5. Record redacted settings metadata/counts and daily trigger outcome. Rollback
   is IDLE_CLEANUP_EXECUTE=false while retaining the fixed start date.

The public policy boolean reports whether the start date is configured, not
the destructive execution flag. Do not use it alone to certify activation.
No runtime settings have been changed in this task.
