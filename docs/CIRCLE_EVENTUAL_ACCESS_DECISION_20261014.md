# Circle — Eventual member authorization (decision / implementation)

**Decision date:** 2026-10-14. **Branch:** `feature/circle-core-blob`.  
**Product:** QWERTY Plus light social only. **Deployment:** NOT MOUNTED / NOT RELEASED.

## Accepted consistency boundary

EdgeOne Blob event storage is the only Circle state store. In accordance
with the user's lightweight-social product decision, membership changes
can propagate during the provider's approximately one-minute consistency
window. This is a product tolerance, **not an instantaneous/global
revocation guarantee or a measured SLA for every failure/recovery case**.

- Member joined: `JOIN_REQUESTED`, unique physical Blob key, logical
  idempotency; joining receives `pending`, not a permanent admission
  certificate.
- Member left: `MEMBER_LEFT`, append-only event, `pending` response.
- Member removed by owner: `MEMBER_REMOVED`, append-only event,
  `pending` response.
- Circle closed by owner: `CIRCLE_CLOSED`, append-only event,
  `pending` response.
- Reconciliation is deterministic. **Remove-wins** and **close-wins** after
  the set of committed events becomes visible. A late join cannot
  re-authorize an account after its removal event is visible.
- No CAS, `onlyIfNew`, seat locking, distributed mutex, atomic counter,
  independent strong revocation service, or extra transactional database.
- Owner/membership checks happen in Cloud Functions against the *visible
  event-replayed state*; all API calls must still be authenticated through
  the existing QWERTY Plus V4 `backend.me(token)` session path.
- During propagation, an already removed member **may temporarily view
  previously permitted social data or post another event** at a stale node.
  Such post-removal content is filtered from the converged view. Do not
  describe an acknowledged `pending` response as an immediate block.
- Raw Blob keys remain **server-private**, with no direct user-side
  Blob access or public links. Only bounded authorized Circle APIs
  return private projections.
- An account's **physical data erasure and deletion orchestration** remain
  separate mandatory privacy work. The user accepts delayed Circle roster
  revocation, **not** incomplete account deletion.
- V4 session validity itself depends on its own established protocol;
  this Circle decision does **not** modify V4, declare its CAS atomic, or
  guarantee globally instant logout.

## Implementation

`createCircleEventualService({log,authenticate,inviteKey})` in
`cloud-functions/_shared/circle/service.js` explicitly opts into
`accessModel='eventual'`. The same service retains the previous
`accessModel='fenced'` only for historical/optional compatibility and its
existing security regression tests. Fenced mode is **not** a light-social
release dependency.

`createCircleEventualAssembly({backend,blobStore,inviteKey,limit})`
in `cloud-functions/_shared/circle/assembly.js` assembles an injected
private Blob Event Log, V4 `me` session validator, light-social service
and existing offline HTTP transport. The `limit` callback must be a
trusted gateway IP/account limiter and must return literal true to allow.
A missing limiter refuses construction.

`cloud-functions/_shared/circle/http.js` remains hard closed and the
production gateway remains unchanged. Assembly is a testable component,
**not** a live deployment or a switch that a public user can enable.

## Validation

The Circle CI must pass both existing strict-fence compatibility tests and
the new event-only tests, covering:

1. Join/leave/remove/close events without a transaction or independent fence.
2. Stale view availability until revoke/close event propagation; convergence
   to remove-wins/close-wins afterward.
3. No nonmember reads/posting, owner-only removal/closure, valid invitation
   and session checks.
4. Duplicate events, lost append responses, logical retries, soft capacity.
5. Offline V4 session + Blob event log + injected rate-limit transport.

Existing sandbox live test covers concurrent unique-key append and
read/replay/cleanup, but not a deployed Cloud Functions gateway nor
multi-region latency.

## Remaining launch conditions

1. Add/qualify a **real** gateway-sourced IP/account rate limiter and bind
   existing authenticated Cloud Function session verification.
2. Integrate Circle account-deletion workflow with retryable erasure and
   residual audit. Maintain nonpublic data scope and minors' privacy defaults.
3. Live-test the embedded Makers Cloud Functions storage route and
   deploy to isolated EdgeOne test branch only with explicit authorization.
4. Performance/replay pagination, request budget, invite abuse prevention,
   bounded logs/retention and UI behavior for `pending` propagation.
5. Do not merge `product/main`, update `master`, or trigger Maker builds
   from this feature branch.
