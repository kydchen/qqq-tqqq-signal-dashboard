# Single-state marginal attribution — pre-registration (FROZEN)

Status: **pre-registered on 2026-07-21 (Asia/Taipei), before implementation code or output existed.**
This document registers a research candidate only; the production strategy
(ruleset `2026-07-v7`) is unchanged. This document merges first on its own;
implementation then starts on a fresh branch cut from the latest `main`.

## Research question

The frozen two-way target sleeve (#9) failed its non-inferiority gates, and
its action audit showed the exposure shift is distributed across states, not
located in normalDca alone. Which **single state replacement** reproduces how
much of the full sleeve gap when applied in isolation?

This is a **single-state marginal attribution** study. It is **not** a causal
decomposition and the per-state numbers **must not be summed**: states
interact through portfolio paths, so the share each state can reproduce in
isolation is descriptive evidence for ranking, nothing more.

## Controls (frozen)

- **P**: the production strategy, exactly as in `runBacktest` (signal sleeve).
- **F**: the full target-weight sleeve, exact variant, exactly as in #9
  (reused, not reimplemented).
- **S1–S5**: P with exactly one state replaced by its #9 target semantics:

| Variant | Replaced state | Target semantics (from #9, frozen) |
| --- | --- | --- |
| S1 | normalDca | exact 10% |
| S2 | smallDipBuy (single-low / mild-dip) | exact 10% |
| S3 | bottomAttack | exact 25% |
| S4 | rampTqqq | progressive 25% + 15% × k / 6, k = 7 − decision.rampMonths |
| S5 | trimHeat | max(10%, current weight × 11/12) |

No 2 pp band in this round; the band would add a second experimental
dimension.

## Execution semantics (frozen, per variant)

At each monthly execution, for the **replaced** state:

1. Month-start contribution lands.
2. The state's retained QQQ/cash incremental action runs exactly as in
   production (the QQQ leg of that state's production action).
3. The TQQQ target is computed from post-action NAV and reached via the #9
   funding waterfall: remaining cash first, then QQQ sales for the shortfall;
   excess TQQQ sold to cash.

All **other** states execute the full production rules (both legs), including
their TQQQ legs. Defensive states keep their production gradual handling in
every variant except S5 (whose replaced state is trimHeat).

Shared conventions, inherited from #9 unchanged: T+1 execution (signal
confirmed at close, executed next session), carry-in handled by the shared
signal machine, 5 bps friction per buy and sell taken from cash, fractional
shares fixed on, 40% TQQQ cap enforced after every execution, post-trade
weights booked as executed (fee drift not corrected).

## Metrics (frozen)

For each variant (P, F, S1–S5) × each start (all 11 supported starts; 5 bps;
$1,000 monthly):

- Final value, max drawdown, Sharpe, and average TQQQ weight.
- Action counts: buy-up-to-target / sell-down-to-target / no-trade, per state.
- Normalized attribution metrics per start:
  - `fullGap = 1 − F/P` (final-value ratio gap of the full sleeve)
  - `stateGap = 1 − Si/P`
  - `gapShare = stateGap / fullGap`
- `gapShare` is interpreted **only when `fullGap ≥ 3%`** for that start;
  otherwise it is reported as `NA — full-sleeve gap below materiality
  threshold`. The 3% threshold is frozen here, not chosen after inspection.
- `gapShare` may be negative or exceed 100% and is **never truncated**:
  negative means the single replacement offsets the full-sleeve gap; above
  100% means the replacement alone overshoots it (state interactions).

Actual-only starts (2010-02-11, 2015-01-01, 2020-01-01, 2023-01-01,
2024-01-01, 2025-01-01) are reported separately from synthetic-TQQQ starts
(1990-01-01, 1995-01-01, 2000-01-01, 2005-01-01, 2010-01-01). All start
windows overlap and are not independent samples.

## Verdict format (frozen)

No win/fail gates. The report presents the per-start ranking of `gapShare`
across S1–S5 as descriptive evidence only, and explicitly declines to name a
single "main cause". The evidence then informs — but does not pre-commit to —
one of two follow-ups:

- a ratchet / one-way floor sleeve (preserves exposure, admits path
  dependence), or
- a fixed-target sleeve with out-of-sample calibration (keeps true path
  independence).

Neither follow-up is implemented in this study.

## Out of scope

- No changes to production strategy, thresholds, risk policies, UI copy, or
  displayed evidence before results and independent review.
- No ratchet implementation, no band variant, no new thresholds, no
  re-optimization after seeing outputs.
