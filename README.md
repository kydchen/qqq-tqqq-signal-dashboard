# QQQ/TQQQ Signal Dashboard

Bilingual QQQ/TQQQ dashboard for three signals, evaluated daily with monthly contributions:

- CAPE rolling 30-year percentile
- Nasdaq-100 rolling 5-year drawdown and fast-crash check
- VIX 5-day average

It also includes an interactive DCA backtest comparing QQQ DCA, TQQQ DCA, new-cash 80/20 QQQ/TQQQ DCA, and a three-signal QQQ/TQQQ timing rule. Backtests use a fixed $1,000 monthly contribution.

## Signal Rule

The signal strategy uses the same monthly contribution as the benchmark strategies, but changes cash deployment and TQQQ exposure:

- 2-3 low signals: deploy about one third of cash into TQQQ, then spend the next 6 months moving toward a 90% TQQQ target.
- 1 low signal: buy QQQ with up to 2x the monthly contribution.
- Fast crash before low-signal convergence: sell about half of TQQQ into cash and do not buy QQQ/TQQQ that month.
- Sustained heat or quiet volatility for 6+ months: sell about 1/12 of TQQQ monthly, keep a 20% TQQQ floor, and keep new monthly cash in cash.
- Normal regime: refill the 20% TQQQ floor first, then buy QQQ; drip surplus cash back at roughly 1/6 per month.

## Local Dev

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:8765
```

## Check

```bash
npm run check
```

Live upstream smoke test:

```bash
npm run check:live
```

Refresh bundled market snapshots:

```bash
npm run update-data
```

Deployment diagnostics:

```text
/api/health
```

## Deploy

Import the repository into Vercel. The static page is `index.html`; serverless API routes live in `api/`.

## Data

- Nasdaq-100: Yahoo Finance `^NDX`
- VIX: Yahoo Finance `^VIX`
- CAPE/Shiller PE: Multpl monthly table
- Static fallback snapshots live in `data/` and are refreshed by the monthly GitHub Action.

Backtests use Nasdaq-100 as a QQQ proxy with a 0.7% annual dividend approximation. TQQQ is synthesized from 3x daily Nasdaq-100 returns after a 0.95% annual expense-ratio drag and approximate 2x short-rate financing cost. Cash earns approximate short-rate interest. The 80/20 variant allocates each new monthly contribution 80% to QQQ and 20% to TQQQ, without rebalancing existing holdings. Backtests still exclude tax, slippage, borrowing limits, tracking error, and live broker execution constraints.
