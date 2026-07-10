# QQQ/TQQQ Signal Dashboard

Bilingual QQQ/TQQQ dashboard for three signals, with monthly contributions and intra-month upgrades:

- CAPE rolling 30-year percentile (S&P broad valuation anchor, not Nasdaq PE)
- Nasdaq-100 rolling 5-year drawdown, mild-drawdown cue, and fast-crash check
- VIX 5-day average as a cross-asset panic proxy

It also includes an interactive DCA workbench comparing five visible strategies: QQQ DCA, Tactical QQQ, TQQQ DCA, Tactical TQQQ, and a three-signal QQQ/TQQQ timing rule. Backtests use a fixed $1,000 monthly contribution.
The chart can optionally overlay actual QQQ closing prices on a right-side y-axis.

The workbench adds:

- Position weights for the signal strategy: cash, QQQ, and TQQQ.
- Event recaps for major regimes such as dot-com, 2008, 2020, 2022, and 2025.
- Action attribution by rule type (path-linked, not causal alpha).
- Walk-forward threshold validation using risk-adjusted excess versus QQQ.
- Data-quality coverage showing real ETF history versus synthetic pre-inception ranges.
- Execution-mode cards explaining Tactical QQQ and Tactical TQQQ as single-ETF reference modes.
- Headline edge card versus QQQ DCA, confidence, month-open lock, and live preview.
- CSV export and shareable URLs.

## Signal Rule

Decision priority:

1. 2-3 low signals: bottom attack
2. Post-bottom ramp window: continue lifting TQQQ
3. 1 low signal or mild drawdown: small QQQ add
4. Fast crash with no discount: crash defense
5. Bubble heat for 6+ months: trim TQQQ
6. Expensive near highs or bubble watch: pause
7. Otherwise: normal DCA

Low signals:

- Valuation cheap: CAPE percentile below 35, or below 50 while Nasdaq-100 is down 25%+
- Deep drawdown: Nasdaq-100 drawdown at or below -20%
- Panic VIX: 5-day average at or above 32

Soft cue:

- Mild drawdown at or below -12% can trigger a small-dip buy without counting as a core low signal

Execution:

- Monthly cash is contributed on the first trading day.
- Intra-month upgrades can raise the action to small-dip buy, bottom attack, or crash defense if conditions worsen after the open.
- Quiet VIX alone no longer forces pause or heat trim.

Position rules for the mixed signal strategy:

- 2-3 low signals: deploy about one third of cash into TQQQ, then spend the next 6 months moving toward a 90% TQQQ target.
- 1 low signal or mild drawdown: buy QQQ with up to 2x the monthly contribution.
- Fast crash before any discount signal: sell about half of TQQQ into cash and do not buy QQQ/TQQQ that month.
- Sustained bubble heat for 6+ months: sell about 1/12 of TQQQ monthly, keep a 20% TQQQ floor, and keep new monthly cash in cash.
- Normal regime: refill the 20% TQQQ floor first, then buy QQQ; drip surplus cash back at roughly 1/6 per month.

The Tactical QQQ and Tactical TQQQ variants reuse the same monthly signal decision but restrict the execution universe:

- Tactical QQQ: buy QQQ in normal, dip, and bottom regimes; pause near highs; sell about 25% of QQQ during fast-crash regimes and about 1/12 during heat regimes.
- Tactical TQQQ: buy TQQQ in normal, dip, and bottom regimes; pause near highs; sell partial TQQQ during fast-crash and heat regimes.

The API still returns the old new-cash 80/20 compatibility strategy, but the main UI, metric cards, and CSV export hide it.

## Why these defaults

Historical first-of-month sampling under the old rules had two hard failures:

- CAPE below the 20th percentile never fired after 1985 in monthly samples, so valuation-cheap was dead.
- COVID March 2020 hit 2 low signals mid-month, but the first trading day still looked normal, so the strategy missed the bottom and later sold on panic alone.

Defaults now use a live-enough cheap threshold, buy-leaning priority over crash sells when a discount is present, and intra-month upgrades.

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
- QQQ adjusted close: Yahoo Finance `QQQ`
- TQQQ adjusted close: Yahoo Finance `TQQQ`
- VIX: Yahoo Finance `^VIX`
- Short rate: FRED `FEDFUNDS`
- CAPE/Shiller PE: Multpl monthly table
- Static fallback snapshots live in `data/` and are refreshed by the monthly GitHub Action.

Backtests use adjusted QQQ/TQQQ closes when available. Before QQQ/TQQQ live history exists, QQQ is proxied from Nasdaq-100 with a 0.7% annual dividend approximation and TQQQ is synthesized from 3x daily Nasdaq-100 returns after a 0.95% annual expense-ratio drag and approximate 2x financing cost. Cash earns FRED FEDFUNDS when available, with a coarse historical fallback. The hidden 80/20 compatibility variant allocates each new monthly contribution 80% to QQQ and 20% to TQQQ, without rebalancing existing holdings. Backtests still exclude tax, slippage, borrowing limits, tracking error, and live broker execution constraints.

Buying TQQQ shares with cash does not create daily broker margin calls. The fund's internal financing, derivatives, fees, daily compounding, and tracking effects are reflected in actual adjusted TQQQ prices after inception and approximated in synthetic pre-inception data. If the investor uses broker margin to buy TQQQ, margin interest is outside this model and must be added separately.

## Decision use

Treat the top panel as a monthly process control, not a prediction machine:

1. Read the effective month action and confidence.
2. Compare month-open lock versus live preview. An upgrade means conditions worsened after the open.
3. Check the vs-QQQ edge card for historical path cost, especially max drawdown and underperformance months.
4. If you only hold QQQ or only hold TQQQ, use the matching tactical card, not the mixed book.
5. Re-check once near month open, and again if the market is crashing mid-month.

This is a research and process tool, not investment advice.
