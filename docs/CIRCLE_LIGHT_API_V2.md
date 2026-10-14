# Circle light social — v2 request contract

2026-10-13. Branch feature/circle-core-blob. Offline/server-only dispatcher.
Production http.js remains hard closed and the gateway is unchanged.
No listener, UI, Cloud Sync change, live store access or Maker deployment.

## Assembly

createCircleTransport({service,rateLimit,maxResponseBytes}) exposes handle(Request).
The service must implement all twelve light Circle methods. The limiter is
mandatory and receives request, token, action and optional circleId. It must
authenticate the actual account and use gateway-trusted source IP metadata,
not caller-provided userId/IP assertions. This dispatcher is NOT mounted.

http.js now contains only the production closed gate; enabled=true still throws.
The unreachable old v1 routes, 12-character Circle IDs and CAS invite-rotation
call were removed from that gate. No environment flag activates Circle.

## Requests and responses

Canonical prefix: /api/circle/v2. Circle IDs: 24 lowercase hexadecimal characters.
Bearer session required. Mutations accept application/json objects with only the
listed keys. Caller actor, role, verified and legacy maxMembers fields are rejected.
softMemberLimit remains advisory, never an admission rule.

| Method/path after prefix | Body/query | Service action |
| --- | --- | --- |
| POST (prefix only) | name, operationId, optional softMemberLimit | createCircle |
| POST /join | inviteCode | joinCircle |
| GET /<id> | none | getCircle |
| DELETE /<id>/me | empty or {} | leaveCircle |
| POST /<id>/remove | memberUserId | removeMember |
| POST /<id>/close | empty or {} | closeCircle |
| POST /<id>/progress/<day> | eventId, completed, newWords | publishProgress |
| GET /<id>/progress/<day> | none | getProgress |
| POST /<id>/claps | memberUserId, day | reactProgress |
| GET /<id>/claps/<memberUserId>/<day> | none | getReactions |
| POST /<id>/showcase | achievementId | shareAchievement |
| GET /<id>/showcase/<memberUserId> | optional ids=ACH_A,ACH_B | getShowcase |

GET success: HTTP 200 with {ok:true,consistency:"eventual",result:...}.
Write acknowledgement: HTTP 202 with the same envelope and pending receipt.
A 202 is not a complete/strongly consistent visible state. Join pending means
propagation, not competitive admission. No permanent membership certificate.

Errors: {ok:false,error:<bounded_code>} without messages, stack or details.
Unknown append returns 503 circle_append_unknown. A failed write response may
still correspond to a committed event; retry creation/progress with the SAME
logical ID and body. Do not blindly replay a fenced leave/remove/close under a
revoked session; use existing trusted recovery.

Every response uses no-store and nosniff, Vary: Authorization. No permissive CORS
headers are added; any later gateway integration owns the CORS policy.

## Minimal boundary controls

- Trusted account/IP limiter checks reads and writes before body/service execution.
  Only exactly true allows the request. Unknown/denied limits stop domain actions.
- Request body is read as a bounded stream, maximum 8192 UTF-8 bytes. Oversized
  input is cancelled; unread streams are cancelled on early rejection.
- Content-Length, if present, must be a safe nonnegative integer matching actual
  bytes. Invalid JSON, invalid UTF-8, arrays/null and unknown fields are rejected.
- Paths are canonical; escaped/empty segments, legacy IDs/v1, unknown routes,
  unsupported methods, extra/duplicate queries and invalid showcase IDs are denied.
- Showcase IDs: at most 24. Unknown maintenance, scrub/recovery and rotation routes
  do not exist. Private membership/retirement logic remains inside the service.
- Response budget defaults to 64KiB; oversized results return 503, never silently
  truncated totals or a falsely complete roster. Use narrower read endpoints.
  This is a response budget, not a member cap.
- This API never exposes account backups or grants official achievements.

## Verification and next work

73 Circle tests pass: the previous 57 core/recovery/privacy tests plus 16 request
tests. Real service + non-atomic in-memory Blob cover the full flow, idempotent
retries, leave/remove/close, member-only reads, limiter denial, field spoofing,
stream cancellation, byte/UTF-8 limits, query/path validation, sanitized failures,
unknown append outcomes, response bounds and the still-closed production gate.

No deployed endpoint, real account/IP limiter, trusted private-access adapter or
live Blob durability/latency qualification is claimed. Full cloud regression
has an unchanged Windows URL.pathname/esbuild failure; see the execution report.

Next: qualify a minimal trusted identity/limiter binding and isolated Blob behavior,
then review gateway wiring separately. UI remains outside the current scope.
Keep the light-social model; do not add hard admission or official reward systems.
