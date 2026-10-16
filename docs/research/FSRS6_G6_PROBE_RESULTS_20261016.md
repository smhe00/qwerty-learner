# G6-0 First Native FSRS-6 Probe Results — 2026-10-16

**Branch:** `research/fsrs6-full-model-20261016`  
**Runtime:** pinned `ts-fsrs@5.4.2`, Node 20.18.0, `request_retention=0.84`, `enable_fuzz=false`.  
**GitHub Actions:** https://github.com/smhe00/qwerty-learner/actions/runs/38838697789  
**Run SHA:** `7d27183d3e5f84ffd5b7747c12c2979654dc146f`  
**Result:** PASS, 4 tests / 4 passed / 0 failed. All traces replay deterministically. Assisted-training and a duplicated rating event were excluded by the isolated research adapter.

## Observed native library behavior

`ts-fsrs` state enum in these traces: Learning=1, Review=2, Relearning=3.

| Observation | Production A | B: short-term on, no steps | C: native Relearning 10m | D: native Learning 1m/10m + Relearning 10m |
|---|---|---|---|---|
| First Good at 2026-10-16 08:00 UTC: due | Oct 21 08:00 | Oct 21 08:00 | Oct 21 08:00 | **Oct 16 08:10** |
| First Good: card state | Review | Review | Review | **Learning** |
| Day 4 Again: due | Oct 21 08:00 | Oct 21 08:00 | **Oct 20 08:10** | **Oct 20 08:10** |
| Day 4 Again: card state | Review | Review | **Relearning** | **Relearning** |
| Day 4 Again: Stability | 0.66154885 | 0.66154885 | 0.66154885 | 0.66154885 |
| 10m later independent Good: Stability | 0.66154885 | **0.71425962** | **0.71425962** | **0.71425962** |
| 10m later independent Good: next due | Oct 23 08:10 | Oct 22 08:10 | Oct 22 08:10 | Oct 22 08:10 |
| Day 8 Hard: Stability | 2.94906969 | 3.07452962 | 3.07452962 | 3.07452962 |

The dates are a **synthetic fixed timeline**, not a recommendation for when learners should be asked to return. In candidate A a same-day independent Good was deliberately supplied to enable a *common-input model comparison*, even though today's production flow does not routinely emit such an event.

A separate two-event lapse probe (initial Good → day-4 Again; no interim 10m Good) returned:
- A: Review, next due **one day later**, S=0.66141652.
- C: Relearning, next due **10 minutes later**, **same S=0.66141652**.

Thus the relearning step itself changes the state and due immediately; **a subsequent independently eligible short-term rating** is what then updates the native card's short-term stability. A timer-only design that never feeds a valid rating to FSRS would not realize that value.

## Interpretation

1. **Real model leverage exists:** when short-term dynamics are enabled, at least the post-lapse same-day Good in this trace changes S, which changes later due. It is not only UI scheduling.
2. **Steps alone are not an optimizer:** `['10m']` is a human-set step interval; research must test alternative timing under equal effort. D's first Good was scheduled at 10m, not 1m; Good can skip a step depending on library mechanics. Never assume every listed step is presented exactly once.
3. **No observed efficacy claims:** A/B/C/D shared a hardcoded rating trace. This proves native behavior and deterministic replay, **not** improvement in retention, fatigue, educational value, or total workload.
4. **Critical integration risk:** Current QWERTY replay filters all Practice and Acquisition; true native Learning/Relearning needs a narrower `FSRS-eligible short-term independent recall` event type and complete card/state replay. A separate source event ID and stricter Rating Gate are mandatory; hinted copying remains training and cannot be relabeled Good.
5. **The smallest high-value next experiment:** Compare A and B on separately scheduled eligible same-day retrievals, without enabling native Learning/Relearning yet. If w17–w19 updates are helpful and predictable, follow with C's native lapse steps. D is the most invasive and stays third.

## Next tasks (not yet completed)

- [ ] G6-1: Reuse the *production* Rating Gate in a research-only event-classification test; explicitly test ESC surrender, assisted completion, spelling mistake vs recall failure, pause and retry.
- [ ] G6-2: Replay full `Card` state with chronological event IDs, across refresh, state reconstruction, and V4 import/export, without mutating current production schemas.
- [ ] G6-3: Extend independent latent-strength simulations to minute-level steps, compare A/B/C/D with matched time budgets, and report 1/7/30/90-day independent spelling outcomes plus active minutes and P95 workload.
- [ ] G6-4: Report the actual improvement (or failure); decide whether any promotion merits a separate production proposal.

**Research decision at this checkpoint:** G6-0 PASS. No integration/promotion decision. Keep production unchanged.
