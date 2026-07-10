# Changelog

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
