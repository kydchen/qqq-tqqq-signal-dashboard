# QQQ/TQQQ Signal Dashboard

Bilingual QQQ/TQQQ dashboard for three monthly signals:

- CAPE percentile
- Nasdaq-100 drawdown and fast-crash check
- VIX 5-day average

It also includes an interactive DCA backtest comparing QQQ DCA, TQQQ DCA, 80/20 DCA, and a three-signal QQQ/TQQQ timing rule.

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

## Deploy

Import the repository into Vercel. The static page is `index.html`; serverless API routes live in `api/`.

## Data

- Nasdaq-100: FRED `NASDAQ100`
- VIX: FRED `VIXCLS`
- CAPE/Shiller PE: Multpl monthly table

Backtests use Nasdaq-100 as a QQQ proxy and synthesize TQQQ from 3x daily Nasdaq-100 returns. They do not include ETF fees, dividends, tax, slippage, borrowing limits, or live broker execution constraints.
