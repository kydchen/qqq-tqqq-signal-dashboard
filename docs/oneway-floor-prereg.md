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

Known asymmetry, declared up front: the production normalDca floor buys up to
10% **only in normalDca months**, while S1-floor applies the one-way floor to
normalDca months *as its replaced state* — the two are close but not
identical, because production also tops up the floor in normalDca months
through `buyTQQQToTarget` and never buys TQQQ in smallDip months. This is a
boundary note, not a confound we hide.

## Frozen data snapshot

All runs use the same versioned snapshot as #9/#10/#11:
**`snapshot-f5c36c72b6dcfa45`** (data through 2026-07-17). Implementation
tests assert this `dataSnapshotId`.

## Metrics (frozen)

Per variant (P, S1-exact, S2-exact, S1-floor, S2-floor) × all 11 starts ×
5 bps × $1,000 monthly:

- Final value, max drawdown, Sharpe, average TQQQ weight.
- Action counts per state: TQQQ shares increased / decreased / unchanged
  across each execution (the floor variants must show **zero** decreases in
  their replaced states — asserted in tests).
- Per-start ratios: `floor / exact` and `floor / P` on final value.
- Actual-only starts (2010-02-11, 2015-01-01, 2020-01-01, 2023-01-01,
  2024-01-01, 2025-01-01) reported separately from synthetic-TQQQ starts
  (1990-01-01, 1995-01-01, 2000-01-01, 2005-01-01, 2010-01-01). All windows
  overlap and are not independent samples.

## Decision rule (frozen)

Interpreted on the actual-only starts where #11's `fullGap ≥ 3%`
(2010-02-11, 2015-01-01, 2020-01-01):

- **Evidence for the downward-sell leg**: `floor / exact ≥ 0.97` in at least
  2 of these 3 starts for **both** S1-floor and S2-floor — i.e. removing only
  the sell leg recovers most of the two-way loss.
- **Evidence against** (the exposure ceiling itself is the problem): floor
  variants stay materially below P (`floor / P < 0.97` in at least 2 of the
  3 starts for both states).
- Mixed or split outcomes are reported as mixed; no winner is declared
  beyond these two readings. This study does not choose between ratchet and
  calibrated fixed-target designs; it only isolates the direction of the
  loss.

## Out of scope

- No ratchet implementation beyond S1-floor/S2-floor as defined here, no
  changes to production strategy, thresholds, risk policies, UI copy, or
  displayed evidence before results and independent review.
- No band variants, no new thresholds, no re-optimization after seeing
  outputs.
