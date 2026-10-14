> **API checkpoint:** [v2 request contract](./CIRCLE_LIGHT_API_V2.md) now has an offline-tested dispatcher (73 passing Circle tests). Production gate remains closed; no gateway/UI/store deployment occurred.

# Circle light social v1 — simplified product decision

2026-10-13, feature/circle-core-blob only. HTTP CLOSED, no UI/V4 change or deployment.
The user explicitly repositioned Circle as optional light social interaction and
soft encouragement. This decision supersedes older Circle capacity-selection,
official achievement verification and activity-conflict quarantine requirements.

## Implemented simple rules

- No seat allocation, hard member limit, overflow waiting list or displacement.
  Every valid visible join is a member. softMemberLimit defaults to 12 and is an
  advisory count only. capacity.hardLimit is always false; aboveSoftLimit does not
  deny joins, reads, posting or claps.
- Join receipts remain pending until the event becomes visible. This means
  synchronization in progress, not a competition for seats or manual approval.
  Membership views have admission="eventual"; late joins cannot eject a member.
- Historical maxMembers values are treated only as advisory hints. New events
  write softMemberLimit. The deprecated create input maxMembers is accepted as a
  hint; conflicting simultaneous old/new options are rejected.
- One progress card per member/day. Completed uses OR across valid reports, and
  newWords uses the highest daily self-report. Do not sum updates or retries.
  This is soft encouragement, not a chronological latest edit, authoritative
  learning statistic, competition score or FSRS/evidence input.
- Achievement shares are always selfReported=true, verified=false. No evidence
  provider is required or called, and no official badge/reward is granted.
  Historical verified shares can be displayed as ordinary social shares, with
  the same nonauthoritative label. The new logical operation family avoids
  conflicting with historical evidence-based share payloads.
- One clap per actor/target/day. No shared counter or strong count guarantee.
- Conflicting activity operations are omitted and counted without blocking the
  whole circle. Malformed progress/achievement payloads are skipped. Envelope,
  creation, membership and revocation integrity remain fail closed.
- read APIs are getCircle, getProgress, getReactions and getShowcase. All retain
  existing member/private-subject authorization. No token, raw intent or revoked
  identity is returned. Input bounds are abuse controls, not membership limits.

## What is intentionally outside this product

No transactional admission service, real-time hard cap, official achievement
evidence pipeline, ranking, reward entitlement or strongly consistent social
counter is being developed for this light version.

Privacy and identity protections are retained. Light social does not authorize
anonymous writes, private member enumeration, regranting revoked access or
claiming erased data. Existing independent access/retirement/recovery hooks remain
unchanged; no new distributed service was added in this tranche.

## Storage and lifecycle

Unique-key append-only events, logical dedup, deterministic replay and eventual
visibility remain the model. Leave/remove/close and retired-account maintenance
retain previous safeguards. No lock, onlyIfNew or authoritative RMW is introduced.
Retention deletion remains a guarded maintenance exception.

No previously deployed v2 data exists in the recorded work: earlier iterations
made no live Circle writes. Legacy replay is tested, but automatic migration or
cross-version retries against existing stores are not certified. The older v1
CAS code remains disabled. Do not silently migrate any real data later.

## Verification and remaining scope

57 Circle tests pass and scoped ESLint passes. Tests now assert that 30 peers
remain members with no waiting list, delayed joins do not displace previous
members or hide their progress, self-report merging is deterministic, evidence
callbacks are unnecessary, and social faults stay local while private reads and
revocation/retirement safety remain guarded.

HTTP is still disabled and not mounted in the production gateway. Production transport binding, separately authorized UI work, existing trustworthy identity/private
access integration and isolated real-store verification remain before user use.
No release, Maker build or live mutation is authorized by this checkpoint.
These are ordinary MVP integration tasks; hard capacity and official incentives
are no longer release blockers.
