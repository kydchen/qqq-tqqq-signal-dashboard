# QQQ/TQQQ Signal Dashboard

Bilingual QQQ/TQQQ dashboard for three monthly signals:

- CAPE percentile
- Nasdaq-100 drawdown and fast-crash check
- VIX 5-day average

It also includes an interactive DCA backtest comparing QQQ DCA, TQQQ DCA, 80% QQQ / 20% TQQQ DCA, and a three-signal QQQ/TQQQ timing rule. Backtests use a fixed $1,000 monthly contribution.

## Signal Rule

The signal strategy uses the same monthly contribution as the benchmark strategies, but changes cash deployment and TQQQ exposure:

- 2-3 low signals: deploy cash into TQQQ, then spend the next 6 months moving toward a 90% TQQQ target.
- 1 low signal: buy QQQ with up to 2x the monthly contribution.
- Fast crash without low-signal convergence: sell about half of TQQQ into cash and do not buy QQQ/TQQQ that month.
- Sustained heat or quiet volatility: sell about 1/12 of TQQQ monthly, keep a 20% TQQQ floor, and keep new monthly cash in cash.
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

Backtests use Nasdaq-100 as a QQQ proxy and synthesize TQQQ from 3x daily Nasdaq-100 returns. The 80/20 variant allocates each new monthly contribution 80% to QQQ and 20% to TQQQ, without rebalancing existing holdings. They do not include ETF fees, dividends, tax, slippage, borrowing limits, or live broker execution constraints.
