# Changelog

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
