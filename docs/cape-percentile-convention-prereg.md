# CAPE percentile convention sensitivity — pre-registration (FROZEN)

Status: **pre-registered on 2026-07-22 (Asia/Taipei), before implementation code or output existed.**
This document registers a research candidate only; the production strategy
(ruleset `2026-07-v7`) is unchanged. This document merges first on its own;
implementation then starts on a fresh branch cut from the latest `main`.

## Research question (frozen)

> Does replacing the current self-inclusive 360-month CAPE percentile with a
> prior-only 360-month empirical reference materially change valuation
> classifications, signal actions, or portfolio outcomes under otherwise
> identical production rules?

## Conventions (frozen, exactly two)

1. **P-current** (production control): for CAPE observation `t`, compare
   `x_t` with `{x_(t-359), ..., x_t}` and compute
   `100 * count(x <= x_t) / 360`. This is exactly the current production
   behavior in `api/_lib.js` (`capePercentileAt` → `rollingPercentile` →
   `percentile`, window `CAPE_ROLLING_MONTHS = 360`, tie rule `item <= value`).
2. **E-prior** (experimental): compare `x_t` with the 360 observations
   immediately before it, `{x_(t-360), ..., x_(t-1)}`, using the same `<=`
   tie rule and `100 * count(x <= x_t) / 360`.

The two equal-sized windows differ by replacing one old observation
(`x_(t-360)`) with the current observation (`x_t`), so the percentile
difference is bounded by `100/360 ≈ 0.278` percentage points. The study
tests whether boundary proximity nevertheless changes discrete rules at
35, 50, 70, or 85.

No extra percentile variants, no threshold tuning.

## Frozen semantics (everything else unchanged)

- The one-month CAPE availability delay remains unchanged: a monthly CAPE
  observation becomes usable the following month, exactly as in
  `capeSeriesForBacktest`.
- Thresholds remain exactly `cheapCape=35`, `supportCape=50`, `highCape=70`,
  `bubbleCape=85`; no recalibration, optimization, or post-result threshold
  selection.
- All non-CAPE signals, the shared monthly state machine, T+1 execution,
  the risk policy, trading costs, and portfolio accounting remain unchanged.
- Evaluation covers the current 11 supported starts
  (`1990-01-01`, `1995-01-01`, `2000-01-01`, `2005-01-01`, `2010-01-01`,
  `2010-02-11`, `2015-01-01`, `2020-01-01`, `2023-01-01`, `2024-01-01`,
  `2025-01-01`) and all three existing costs (0/5/10 bps). The six
  actual-TQQQ starts (`2010-02-11`, `2015-01-01`, `2020-01-01`,
  `2023-01-01`, `2024-01-01`, `2025-01-01`) and the five
  synthetic-containing starts (`1990-01-01`, `1995-01-01`, `2000-01-01`,
  `2005-01-01`, `2010-01-01`) are reported separately. All start windows
  overlap and are not independent samples.
- Point-in-time CAPE revision history is unavailable from the current
  source (`capePointInTime: false`). This study **cannot fix or validate
  vintage/revision bias** and must not be described as making valuation
  "more accurate".

## Verified repository facts (basis of this pre-registration)

Verified directly against `api/_lib.js` and `data/` on 2026-07-22:

- Production percentile is self-inclusive over the latest 360 monthly
  observations with the `<=` tie rule, and the monthly CAPE value is
  delayed to the following month before use.
- The CAPE snapshot holds 1,866 monthly observations, oldest
  `1871-02-01`, newest `2026-07-17`.
- Supported market/backtest history begins with NDX at `1985-10-01`
  (VIX at `1990-01-02`; earliest supported backtest start `1990-01-01`).
  The earliest app-supported state already has more than 1,370 CAPE
  observations behind it, so **every app-supported state has at least 360
  CAPE observations**. The previously suspected "pre-2015 insufficient
  30-year window" issue is **not present** in the current data; it is
  treated as a coverage audit to be closed, not as an experimental variant.

## Frozen data snapshot

All runs use the versioned snapshot **`snapshot-f5c36c72b6dcfa45`** (data
through 2026-07-17), verified with the repository helper
`buildDataSnapshotId(loadSnapshotData())`. Implementation tests must
assert this `dataSnapshotId`, so an automated data refresh cannot
silently change the study object.

## Outputs (frozen before implementation)

1. **Coverage audit**: oldest/newest CAPE observation, earliest month with
   a prior 360-month window, earliest price/backtest date, and an
   assertion that every evaluated app state has full history.
2. **Percentile audit** over every CAPE observation used by app-supported
   market dates: maximum/median/95th-percentile absolute
   `E-prior − P-current` difference; for each threshold 35/50/70/85, count
   and list every classification crossing.
3. **Daily state/action audit**: count and list every date where the
   frozen decision key differs, including the relevant CAPE percentile,
   threshold bit, other signal bits, and resulting action. Because CAPE is
   monthly but decisions can upgrade intra-month, compare the complete
   daily state-machine trajectory, not only first-of-month rows.
4. **Backtest audit** for 11 starts × 3 costs: P and E final value, E/P
   ratio, max drawdown and pp delta, action counts, and the dates/actions
   responsible for any divergence. Separate actual-only and
   synthetic-containing summaries.
5. **Deterministic generated Markdown report**, frozen snapshot assertion,
   and regression tests that the report matches the generator
   byte-for-byte.

## Interpretation (frozen before seeing results)

- If there are zero decision/action differences, conclude the convention
  is operationally immaterial on current history and keep production
  unchanged to avoid needless churn.
- If there is any decision/action difference, report it as sensitivity
  evidence only. Do **not** automatically adopt whichever convention has
  higher return. Thresholds were historically developed under `P-current`,
  so any production switch would require a separate semantic decision or a
  separately pre-registered recalibration study.
- For descriptive materiality only (not a pass/fail optimization gate),
  flag absolute final-value changes ≥1%, maximum-drawdown changes ≥1
  percentage point, or any action-key change.
- No claim of causality, forecast improvement, out-of-sample validation,
  or valuation accuracy.

## Out of scope

- No changes to production strategy, thresholds, API, website, snapshots,
  or generated reports before results and independent review.
- No additional percentile variants, no threshold recalibration, no
  re-optimization after seeing outputs.
