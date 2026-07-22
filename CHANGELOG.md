# Changelog

## 0.7.3 - 2026-07-22

Response slimming, front-end backtest caching, and API determinism; no strategy or backtest behavior change.

- `/api/backtest` accepts an optional `strategies=` comma-separated allowlist (any of `qqq`, `tqqq`, `blend8020`, `signal`, `signalQqq`, `signalTqqq`). It trims the top-level `strategies` array and the nested `events[].strategies` arrays; `qqq` and `signal` are always included because the edge conclusion, event cards, and execution notes depend on them. Unknown keys return HTTP 400. Omitting `strategies` returns the full legacy strategy set; `generatedAt` is intentionally removed from all responses. The engine always computes every sleeve — only the returned JSON is trimmed.
- Removed `generatedAt` from the backtest response (the only time-dependent field; the frontend did not use it), and the API is now asserted deterministic: identical inputs serialize byte-identically.
- The frontend now requests a fixed five-strategy set (the visible curves) regardless of the current checkbox selection and keeps an in-memory cache of successful backtest responses keyed by `{start, cost}`; failed requests are never cached, and the manual refresh button clears the cache.

## 0.7.2 - 2026-07-19

Frontend and data hardening; no strategy or backtest behavior change.

- Execution planner errors now carry stable codes (`RANGE`, `POLICY_UNAVAILABLE`, `TARGETS_EXCEED_CAP`, `QUOTES_UNAVAILABLE`, `COST_CHOICE`, `ACTION_UNAVAILABLE`) and the Chinese messages map codes instead of matching English message prefixes.
- Unified HTML escaping for API-sourced fields in the events, data-quality, and order-draft views.
- Removed duplicate render passes: `renderMarket` and `renderBacktest` no longer re-render the execution guides, order draft, or edge card; each section renders exactly once per `renderStatic` pass, and `loadBacktest` refreshes the backtest-derived cards explicitly.
- Risk-profile notes are generated from the API's `riskPolicies` values instead of hardcoded percentages, with the static copy as fallback before data loads.
- Snapshot read-side validation: ISO dates, strictly ordered entries (CAPE is newest-first), finite positive values; large daily jumps warn once per process instead of rejecting real market data.
- `/api/health` now reports `status: "degraded"` (still HTTP 200) when an upstream source is down and snapshot fallback is serving, so upstream outages stay visible to monitoring.

## 0.7.1 - 2026-07-19

Evidence-framing fixes; no strategy or backtest behavior change.

- Renamed the walk-forward panel to a historical threshold-robustness diagnostic and disclosed in both the UI and `modelNotes.walkForward` that default thresholds were informed by historical walk-forward results, that validation windows overlap, and that thresholds are frozen as of 2026-07 (ruleset v6), so genuine forward evidence can only accumulate from the freeze onward.
- Labeled event-recap cards that contain synthetic TQQQ history, added a synthetic-range caution to the sensitivity grid for pre-inception start dates, and added `modelNotes.syntheticScope` stating which panels include synthetic TQQQ.

## 0.7.0 - 2026-07-19

Ruleset `2026-07-v7` unifies the monthly signal state machine and fixes cross-month carry-in handling.

- Extracted one shared monthly signal machine (`createSignalMachine`/`signalMachineClose`/`signalMachineDue`) now used by the live panel, the monthly decision log, memory replay, and the backtest; the four hand-rolled copies are gone.
- Signal memory (ramp/heat counters) now advances at decision confirmation in the backtest too; it previously advanced at next-session execution there while the live paths advanced it at decision time.
- Fixed the cross-month carry-in bug: a decision made on a month's last close still executes on the first session of the next month, but it no longer swallows that new month's own month-start lock. Carry-in executions are recorded on the monthly point as `carryIn` with their original decision and execution dates.
- Historical impact on versioned snapshots: results are unchanged for 2000 and later starts; 1990/1995 starts change exactly one month (1997-11 now trades both the October carry-in and its own small-dip lock), adding one smallDipBuy and moving signal final value by roughly +0.05%.
- Rebuilt the state pipeline O(N) with a bit-identical slow reference kept in tests; full-history states and every start/cost action trajectory are asserted equal, and the total test suite runs in about 3 seconds.

## 0.6.0 - 2026-07-12

Ruleset `2026-07-v6` makes the standard risk policy the mixed strategy's single source of truth.

- Changed the main mixed-strategy backtest from the aggressive profile to the standard profile: 40% TQQQ cap, 10% normal floor, 25% bottom target, and 40% post-bottom target.
- Kept the 90% aggressive profile as an optional manual-execution scenario instead of presenting it as the default strategy.
- Aligned strategy-workbench results, sensitivity runs, event recaps, walk-forward checks, API metadata, and bilingual rule copy with the standard profile.
- Re-ran every supported start window with the versioned local data snapshots and updated regression checks for the revised risk semantics.

## 0.5.0 - 2026-07-12

Ruleset `2026-07-v5` keeps core QQQ participation alive during long expensive bull markets.

- Replaced the mixed strategy's zero-buy high regime with a 50% monthly QQQ core purchase while keeping new TQQQ buying paused.
- Kept the same 50% core QQQ purchase during sustained heat while continuing the existing gradual TQQQ trim.
- Selected 50% after testing 25/50/60/75/100% variants across start windows and 0/5/10 bp costs; it fixed the 2024/2025 cold-start gap without the larger drawdown increase of 60-75% variants.
- Aligned the deterministic backtest, browser order planner, bilingual rule copy, and regression checks.
- Added 2023 and 2024 as first-class backtest start windows so the AI bull-market cold-start behavior is visible on the site.

## 0.4.0 - 2026-07-10

Ruleset `2026-07-v4` hardens the financial trust boundary after an external adversarial review.

- Fixed staged TQQQ buys so QQQ rotation cannot bypass the monthly cash budget.
- Delayed historical monthly CAPE observations by one month to remove same-month look-ahead.
- Made fast-crash defense reachable when no core low signal is active.
- Enforced the aggressive TQQQ cap at each strategy execution and aligned bottom-attack budgeting with the cockpit.
- Preserved next-session actions across month boundaries instead of dropping month-end upgrades.
- Added close-only Yahoo handling, freshness-based snapshot fallback, bounded retries, stricter source validation, and atomic snapshot writes.
- Added independent order friction, 30-minute market/draft expiry, manual refresh, fetch timeouts, and local-journal hardening.
- Moved all eight supported start-window audits into normal CI and added targeted planner regression tests.

## 0.3.0 - 2026-07-10

Ruleset `2026-07-v3` turns the dashboard into a local-first manual decision cockpit.

- Backtests now use versioned bundled snapshots and execute signals at the next trading session.
- Added 0/5/10 bp trading-friction scenarios; 5 bp is the default.
- Replaced the uncalibrated confidence score with qualitative rule strength.
- Corrected Sharpe to use monthly excess returns over the modeled cash rate.
- Headline evidence excludes synthetic TQQQ history and adds an average-allocation static diagnostic, maximum relative drawdown, and longest relative underperformance.
- Added conservative, standard, and aggressive risk policies without changing signal thresholds.
- Added browser-local holdings, manual order drafts, recurring month-open calendar export, and an execution journal.
- Critical stale signal data now disables the current action; stale ETF quotes disable order drafting.
- Added deterministic planner tests and GitHub CI.

## 0.2.0 - 2026-07-09

Ruleset `2026-07-v2` added month-open locking, intra-month upgrades, revised CAPE/VIX thresholds, and decision-first evidence panels.
