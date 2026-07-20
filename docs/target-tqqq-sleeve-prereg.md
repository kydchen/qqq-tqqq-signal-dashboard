# Target-weight TQQQ sleeve — pre-registration (FROZEN)

Status: **frozen on 2026-07-19, before any implementation output was inspected.**
Branch: `agent/tqqq-sleeve-prereg`. Ruleset under study: `2026-07-v7` (production
strategy unchanged; this document registers a research candidate only).

This study replaces only the TQQQ sleeve's incremental buy/sell rules with a
target-weight rebalance. Everything else about the production three-signal
strategy stays byte-identical. No production strategy, UI copy, or displayed
evidence may change until results exist and pass independent review.

## Research question

Can a target-weight TQQQ sleeve **reduce the holding path dependence of the
build-up states** (normalDca, single-low / mild-dip, bottomAttack, rampTqqq)
**while preserving the current gradual handling of the defensive states**
(trimHeat, pauseAtHigh, crashDefense)?

Explicitly not claimed: eliminating path dependence of the whole TQQQ sleeve.
The defensive states below deliberately keep holdings-dependent rules, and
ramp/heat memory, contribution history, and the QQQ/cash side all remain
path-dependent. Whether a full three-asset target table is worth it is a
phase-2 question this study does not answer.

## Design under test

### Signal side (unchanged)

All state inputs (CAPE percentile, drawdown, crash25d, VIX), the shared
monthly signal machine, ramp/heat memory, thresholds, and the standard risk
policy are reused exactly as in production. Only the *action semantics* of the
TQQQ sleeve change.

### TQQQ target mapping

| State | TQQQ target weight | Source |
| --- | --- | --- |
| normalDca | 10% | `normalTqqqFloor` |
| single low signal / mild drawdown | 10% | same |
| bottomAttack | 25% | `bottomTqqqTarget` |
| rampTqqq month k | 25% + 15% × k / 6, with `k = 7 - decision.rampMonths` | `rampTqqqTarget`, gradual |
| trimHeat | max(10%, current weight × 11/12) | keeps the 1/12-per-month unwind speed |
| pauseAtHigh | freeze current weight (no trade) | keeps "pause new buys, no sell" |
| crashDefense | current weight × 50% | keeps "sell about half" (holdings-dependent by design) |

Ramp-month targets under the frozen subscript are exactly:
27.5%, 30%, 32.5%, 35%, 37.5%, 40% for k = 1..6. The engine's
`decision.rampMonths` counts down from 6 to 1, so `k = 7 - rampMonths` counts
up; implementations must not invert this.

The global 40% TQQQ cap (`maxTqqq`) is enforced after every rebalance, as in
production.

### Funding waterfall (frozen)

"QQQ/cash unchanged" is impossible together with "reach an exact TQQQ target"
(e.g. starting from 100% QQQ cannot fund a 25% TQQQ target). The frozen order
at each monthly execution is therefore:

1. Execute the retained QQQ/cash incremental actions exactly as the current
   strategy does (month-start contribution, 1x/2x dip buys, 50% high-regime
   core QQQ, 1/6 cash drip — QQQ **signal rules** unchanged, QQQ **holdings**
   not guaranteed unchanged).
2. Compute NAV after those actions; derive the TQQQ target value from it.
3. If TQQQ is below target: spend remaining cash first, then sell QQQ for the
   shortfall (the engine already sells QQQ to fund TQQQ in capped cases).
4. If TQQQ is above target: sell TQQQ down to target; proceeds stay in cash.
5. All trades at next-session prices, 5 bps friction per buy and sell, taken
   from cash. Fractional shares are fixed on. Post-trade weights are booked as
   executed; fee drift is not corrected.

### Rebalance variants

- **Exact**: rebalance to the precise target every month (baseline).
- **2 pp band**: trade only when the actual TQQQ weight deviates from target
  by more than 2 percentage points; when trading, rebalance to the **exact
  target** (not the band edge).

## Path-independence test protocol

Primary evidence is a convergence test, **not** overlapping NAV paths from
different start dates:

1. Fix a date D, a signal memory, and a total asset value.
2. Initialize three portfolios: 100% cash, 100% QQQ, and the current
   production-strategy holding.
3. Run one monthly execution of each variant.
4. Exact variant: after the rebalance all three portfolios' TQQQ weights must
   equal the target, up to fee epsilon.
5. Band variant: each portfolio's distance to target must be ≤ 2 pp + fee
   epsilon. Because two portfolios can land on opposite sides of the target,
   the maximum pairwise difference bound is **4 pp + fee epsilon**; do not
   generalize a ≤2 pp pairwise claim.

## Acceptance gates (frozen)

- Final-value ratio `sleeve / current strategy` **≥ 0.97** in at least 5 of
  the 6 actual-only starts (2010-02-11, 2015, 2020, 2023, 2024, 2025).
  One-sided non-inferiority: **no 1.03 upper bound**; a ratio above 1.03 is
  not a failure but the source of the extra risk exposure must be explained.
- Max-drawdown worsening ≤ 2 percentage points versus the current strategy in
  **all 6** actual-only starts.
- Convergence assertions in the protocol above all pass.
- Report in full: turnover, total fees, and average cash/QQQ/TQQQ weights for
  both variants and the current strategy.
- Synthetic-TQQQ windows are reported separately and do **not** count toward
  the pass gate.
- The allocation-matched comparison, if shown, is labeled an *ex-post
  position-level diagnostic* — not an investable, fully pre-registered
  control strategy.

## Out of scope

- No changes to production strategy, thresholds, risk policies, UI copy, or
  displayed evidence before results and independent review.
- No full three-asset target table (phase 2, only if this study justifies it).
- No tolerance bands other than 2 pp, no re-optimization of the mapping table
  after seeing outputs.
