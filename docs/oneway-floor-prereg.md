# One-way floor (S1/S2) vs two-way target — pre-registration (FROZEN)

Status: **pre-registered on 2026-07-21 (Asia/Taipei), before implementation code or output existed.**
This document registers a research candidate only; the production strategy
(ruleset `2026-07-v7`) is unchanged. This document merges first on its own;
implementation then starts on a fresh branch cut from the latest `main`.

## Research question

#11 found that S2 (smallDipBuy → two-way exact 10%) is the largest
single-state marginal replacement of the full sleeve gap, but its semantics
are two-way — buy up to 10% and sell down to 10% (share increase/decrease
counts of 14/11, 10/6, 7/4 in the three interpretable actual-only starts), so
the directions were not separated. This study asks the direct question:

**Does the frozen two-way sleeve's shortfall come from the downward-sell
leg?**

## Controls (frozen)

- **P**: the production strategy, exactly as in `runBacktest` (reused).
- **S1-exact / S2-exact**: the two-way exact-10% single-state variants from
  #11 (reused, not reimplemented).
- **S1-floor / S2-floor**: P with exactly one state replaced by its one-way
  floor semantics:
  - **S1-floor**: normalDca → buy TQQQ up to 10% only when the current TQQQ
    weight is below 10%; when at or above 10%, no sleeve trade.
  - **S2-floor**: smallDipBuy → same one-way floor rule in smallDipBuy months.
  - All other states run the full production rules (both legs).

Execution conventions, unchanged from #9/#10/#11: month-start contribution,
the retained QQQ/cash incremental action of the replaced state first, then
the sleeve adjustment (a **buy leg only** here: remaining cash, then QQQ
sales for the shortfall — no sell leg can trigger by construction), T+1, 5
bps friction, fractional shares, post-trade weights booked as executed. The
40% cap timing follows #10: production timing (before the action) for P and
unreplaced states; the floor variant buys up to 10% and therefore cannot
breach the cap through its own leg, but the cap is still enforced after its
rebalance for uniformity with #9.

Cap-driven sales vs the floor sell leg: entering a month with weight above
40% still triggers the post-rebalance cap sale. Tests therefore assert the
precise property — **the floor adjustment logic itself never calls a TQQQ
sell** — and cap-enforcement sales are recorded separately from the sleeve's
own sells, so the "zero sell leg" claim applies to the floor logic, not to
cap enforcement.

Known asymmetry, stated precisely: in production, normalDca tops TQQQ up to
the floor **first** and buys QQQ **after**; in S1-floor the retained QQQ
action runs **first** and the TQQQ top-up is funded **after** from remaining
cash, then from QQQ sales. The order of the two legs and the funding source
both differ; the variants are not "close versions" of the same rule. In
smallDip months production never buys TQQQ, so S2-floor introduces a buy leg
where production has none. These are declared differences, not confounds we
hide.

## Frozen data snapshot

All runs use the same versioned snapshot as #9/#10/#11:
**`snapshot-f5c36c72b6dcfa45`** (data through 2026-07-17). Implementation
tests assert this `dataSnapshotId`.

## Metrics (frozen)

Per variant (P, S1-exact, S2-exact, S1-floor, S2-floor) × all 11 starts ×
5 bps × $1,000 monthly:

- Final value, max drawdown, Sharpe, average TQQQ weight.
- Action counts per state: TQQQ shares increased / decreased / unchanged
  across each execution, split by cause (floor logic vs cap enforcement).
  Tests assert the floor adjustment logic never sells TQQQ; any decrease
  recorded under cap enforcement does not count as a floor sell leg.
- Per-start ratios: `floor / exact` and `floor / P` on final value.
- Actual-only starts (2010-02-11, 2015-01-01, 2020-01-01, 2023-01-01,
  2024-01-01, 2025-01-01) reported separately from synthetic-TQQQ starts
  (1990-01-01, 1995-01-01, 2000-01-01, 2005-01-01, 2010-01-01). All windows
  overlap and are not independent samples.

## Decision rule (frozen)

Interpreted on the actual-only starts where #11's `fullGap ≥ 3%`
(2010-02-11, 2015-01-01, 2020-01-01), **for S1-floor and S2-floor
separately**:

- `floor / exact ≥ 1.03` **and** `floor / P ≥ 0.97`: the downward-sell leg is
  the main source of the two-way loss, and removing it basically recovers
  the loss.
- `floor / exact ≥ 1.03` **but** `floor / P < 0.97`: the sell leg
  contributes, but cannot fully explain the gap; the residual may come from
  the buy leg, action ordering, QQQ funding, or path interactions.
- `floor / exact ≤ 0.97`: does not support the sell-leg explanation.
- `0.97 < floor / exact < 1.03` (strict): insufficient evidence.

A joint conclusion is drawn only when S1-floor and S2-floor land in the
**same** band; otherwise the outcome is reported as split. Aggregation across
starts is frozen as follows: each start is banded independently; for each
state (S1, S2) separately, a band must cover **at least 2 of the 3 starts**
for the state to be assigned that band, otherwise the state is recorded as
`mixed`. A joint conclusion requires both states to land in the same
(non-mixed) band. Note the floor variants have no exposure ceiling above
10%, so "floor / P < 0.97" is **not** read as evidence about a 10% ceiling —
it is read per the second bullet above. This study does not choose between
ratchet and calibrated fixed-target designs; it only isolates the direction
of the loss.

## Out of scope

- No ratchet implementation beyond S1-floor/S2-floor as defined here, no
  changes to production strategy, thresholds, risk policies, UI copy, or
  displayed evidence before results and independent review.
- No band variants, no new thresholds, no re-optimization after seeing
  outputs.
