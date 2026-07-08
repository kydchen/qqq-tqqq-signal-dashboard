const $ = (id) => document.getElementById(id);

const colors = {
  qqq: "#1d4ed8",
  tqqq: "#b42318",
  blend8020: "#0f766e",
  signal: "#6d28d9",
};

const actionOrder = ["bottomAttack", "rampTqqq", "smallDipBuy", "crashDefense", "trimHeat", "pauseAtHigh", "normalDca"];
const actionVisuals = {
  bottomAttack: { icon: "T", color: "#b42318" },
  rampTqqq: { icon: "T+", color: "#dc2626" },
  smallDipBuy: { icon: "Q", color: "#0f766e" },
  crashDefense: { icon: "1/2", color: "#7f1d1d" },
  trimHeat: { icon: "-T", color: "#b45309" },
  pauseAtHigh: { icon: "$", color: "#475467" },
  normalDca: { icon: "Q", color: "#1d4ed8" },
};

const copy = {
  zh: {
    eyebrow: "QQQ / TQQQ",
    title: "纳指三信号仪表盘",
    subtitle: "用估值、回撤和恐慌度决定本月买 QQQ、买 TQQQ、暂停，还是减 TQQQ。",
    refresh: "刷新数据",
    run: "运行回测",
    decisionKicker: "建议操作",
    loadingAction: "加载中",
    loadingOperation: "正在拉取市场数据。",
    capeLabel: "CAPE 分位",
    ddLabel: "纳指 100 回撤",
    vixLabel: "VIX 5 日均值",
    methodKicker: "计算方法",
    methodTitle: "三类信号，按月决策",
    actionCatalogKicker: "动作清单",
    actionCatalogTitle: "三信号策略会做什么",
    actionCatalogNote: "三信号策略按低位、快崩、高位、常态四类规则处理。只有三信号策略会卖出和留现金；QQQ、TQQQ、80/20 三个基准策略只按月买入，不卖出。",
    backtestKicker: "收益回测",
    backtestTitle: "比较不同定投方式",
    startLabel: "起始时间",
    monthlyLabel: "每月投入",
    trendLabel: "显示 log 趋势拟合线",
    actionMarkersLabel: "显示月度动作",
    hideActionMarkersLabel: "隐藏月度动作",
    backtestNote: "回测使用 Nasdaq-100 指数代理 QQQ；TQQQ 用 3x 日收益再平衡合成，未扣除基金费、税费、滑点和股息。80/20 是每月新增资金 80% 买 QQQ、20% 买 TQQQ，不对存量仓位再平衡。三信号策略包含现金仓、小底 QQQ 加仓、大底后 6 个月向 90% TQQQ 推进、高位 TQQQ 锁利卖出，并保留 20% TQQQ 地板仓。",
    sources: "数据源：",
    error: "数据加载失败：",
    methods: [
      {
        title: "估值：CAPE 历史分位",
        body: "取最新 Shiller PE/CAPE，与 1871 年以来的月度历史值比较。低于 20% 代表便宜，高于 70% 代表高估，高于 85% 进入泡沫警戒。估值变化慢，适合决定是否放大或收缩杠杆。"
      },
      {
        title: "趋势：回撤与快崩",
        body: "用 Nasdaq-100 最近 5 个交易日均值，相对历史最高值计算回撤；再与约 25 个交易日前的 5 日均值比较。回撤超过 20% 是深跌，25 日跌超 12% 先按风控处理。"
      },
      {
        title: "恐慌：VIX 5 日均值",
        body: "VIX 反映 S&P 500 期权隐含的近端波动预期。这里取 5 日均值降噪。高于 40 视为恐慌共振，低于 12 视为过度平静，后者通常不适合追 TQQQ。"
      }
    ],
    decisions: {
      bottomAttack: ["大底进攻", "现金仓全部买入 TQQQ；随后 6 个月逐步把组合推向 90% TQQQ。", "这是低估、深跌、恐慌共振时才触发的进攻动作。"],
      smallDipBuy: ["小底加仓", "最多用 2 倍月投入买 QQQ；多余现金继续等待更强信号。", "这是折扣区，不是梭哈区。"],
      crashDefense: ["快崩风控", "卖出约一半 TQQQ，转入现金仓，等低位信号共振再打回。", "快崩阶段先活下来，再考虑抄底。"],
      pauseAtHigh: ["高位暂停", "本月暂停新增 QQQ/TQQQ 买入，新增资金进入现金仓。", "高估且贴近新高时，策略赚的是耐心，不是追涨。"],
      trimHeat: ["过热锁利", "卖出约 1/12 TQQQ，但保留 20% TQQQ 底仓；新增资金进入现金仓。", "这是降低路径风险，不是看空全部美股。"],
      normalDca: ["正常定投", "先把 TQQQ 补到约 20% 地板仓，剩余资金买 QQQ；现金仓按每月 1/6 慢慢滴灌回 QQQ。", "没有低位信号时，只保留小杠杆底仓，不主动追高。"],
    },
    actions: {
      bottomAttack: { title: "大底进攻", condition: "2-3 个低位信号同时亮", operation: "现金仓 + 当月新增资金全部买 TQQQ" },
      rampTqqq: { title: "大底后加速", condition: "大底进攻后的 6 个月", operation: "用新增资金并逐步从 QQQ 切到 TQQQ，目标约 90%" },
      smallDipBuy: { title: "小底加仓", condition: "只有 1 个低位信号亮", operation: "最多 2x 月投入买 QQQ" },
      crashDefense: { title: "快崩风控", condition: "25 日跌幅 <= -12%，且没有低位共振", operation: "卖出约 1/2 TQQQ，转现金" },
      trimHeat: { title: "过热锁利", condition: "过热/过静持续 6 个月以上", operation: "每月卖出约 1/12 TQQQ，但保留 20% 地板仓" },
      pauseAtHigh: { title: "高位暂停", condition: "CAPE >= 70% 且指数距高点 < 5%", operation: "不买 QQQ/TQQQ，当月资金留现金" },
      normalDca: { title: "正常定投", condition: "没有触发以上任何动作", operation: "先补 20% TQQQ 底仓，再买 QQQ；现金仓按 1/6 滴灌" },
    },
    chips: {
      valuationCheap: "估值便宜",
      deepDrawdown: "深度回撤",
      panicVix: "VIX 恐慌",
      valuationHigh: "高估",
      nearHigh: "贴近新高",
      fastCrash: "快崩",
      quietVix: "过静",
    },
    strategies: {
      qqq: "QQQ 定投",
      tqqq: "TQQQ 定投",
      blend8020: "80% QQQ / 20% TQQQ 定投",
      signal: "三信号策略",
    },
    metricLabels: {
      finalValue: "期末资产",
      multiple: "投入倍数",
      irr: "IRR",
      maxDrawdown: "最大回撤",
      regression: "log 趋势年化",
    },
    meta: (data) => `生成时间 ${data.generatedAt}；CAPE 日期 ${data.indicators.cape.date}；纳指最新日期 ${data.indicators.nasdaq100.date}；低位信号 ${data.decision.lowSignalCount}/3。`,
    capeNote: (cape) => `CAPE ${cape.value.toFixed(2)}；样本 ${cape.historyCount} 个月。`,
    ddNote: (ndx) => `5 日均值 ${fmtNumber(ndx.level5dAvg, 0)}；25 日变化 ${fmtPct(ndx.crash25dPct)}。`,
    vixNote: (vix) => `最新 ${vix.latest.toFixed(2)}；日期 ${vix.date}。`,
  },
  en: {
    eyebrow: "QQQ / TQQQ",
    title: "Nasdaq Three-Signal Dashboard",
    subtitle: "Use valuation, drawdown, and volatility to decide whether to buy QQQ, buy TQQQ, pause, or trim TQQQ this month.",
    refresh: "Refresh",
    run: "Run backtest",
    decisionKicker: "Action",
    loadingAction: "Loading",
    loadingOperation: "Fetching market data.",
    capeLabel: "CAPE percentile",
    ddLabel: "Nasdaq-100 drawdown",
    vixLabel: "VIX 5-day average",
    methodKicker: "Method",
    methodTitle: "Three monthly signals",
    actionCatalogKicker: "Action list",
    actionCatalogTitle: "What the signal strategy can do",
    actionCatalogNote: "The signal strategy handles low-signal, fast-crash, high-heat, and normal regimes. Only the signal strategy sells and holds cash. QQQ, TQQQ, and 80/20 benchmarks only buy monthly and never sell.",
    backtestKicker: "Return backtest",
    backtestTitle: "Compare DCA variants",
    startLabel: "Start date",
    monthlyLabel: "Monthly buy",
    trendLabel: "Show log trend fit",
    actionMarkersLabel: "Show monthly actions",
    hideActionMarkersLabel: "Hide monthly actions",
    backtestNote: "Backtest uses Nasdaq-100 as a QQQ proxy. TQQQ is synthesized from 3x daily Nasdaq-100 returns before fees, taxes, slippage, and dividends. The 80/20 variant puts each new monthly contribution 80% into QQQ and 20% into TQQQ; it does not rebalance existing holdings. The signal strategy includes cash, small-dip QQQ buying, a 6-month post-bottom ramp toward 90% TQQQ, high-heat TQQQ trimming, and a 20% TQQQ floor.",
    sources: "Sources: ",
    error: "Data load failed: ",
    methods: [
      {
        title: "Valuation: CAPE percentile",
        body: "Compare the latest Shiller PE/CAPE with monthly history back to 1871. Below 20% is cheap, above 70% is expensive, and above 85% is bubble-watch territory. Valuation moves slowly, so it sizes leverage rather than timing every tick."
      },
      {
        title: "Trend: drawdown and fast crash",
        body: "Use the Nasdaq-100 5-day average versus its running high to measure drawdown, then compare it with the 5-day average around 25 trading days ago. A 20% drawdown is deep; a 12% 25-day drop triggers risk control first."
      },
      {
        title: "Fear: VIX 5-day average",
        body: "VIX reflects near-term volatility implied by S&P 500 options. A 5-day average reduces noise. Above 40 marks panic; below 12 marks excessive calm, which is usually a poor time to chase TQQQ."
      }
    ],
    decisions: {
      bottomAttack: ["Bottom attack", "Deploy all cash into TQQQ, then spend 6 months moving the portfolio toward 90% TQQQ.", "This only fires when cheap valuation, deep drawdown, and panic start to converge."],
      smallDipBuy: ["Small dip buy", "Buy QQQ with up to 2x the monthly contribution; keep excess cash for stronger signals.", "This is a discount zone, not an all-in signal."],
      crashDefense: ["Fast-crash defense", "Sell about half of TQQQ into cash, then wait for low signals to converge before redeploying.", "Survive the fast crash before trying to catch the bottom."],
      pauseAtHigh: ["Pause at high", "Pause new QQQ/TQQQ buying this month. Route new money to cash.", "When valuation is high near the index high, patience is the edge."],
      trimHeat: ["Trim heat", "Sell about 1/12 of TQQQ, keep a 20% TQQQ floor, and route new money to cash.", "This lowers path risk; it is not an all-equity bearish call."],
      normalDca: ["Normal DCA", "First refill the TQQQ floor to about 20%, then buy QQQ. If cash exists, drip about 1/6 of it back into QQQ each month.", "Without low signals, keep only a small leverage floor instead of chasing."],
    },
    actions: {
      bottomAttack: { title: "Bottom attack", condition: "2-3 low signals are on", operation: "Deploy cash + monthly contribution into TQQQ" },
      rampTqqq: { title: "Post-bottom ramp", condition: "6 months after a bottom attack", operation: "Use new money and rotate from QQQ toward a 90% TQQQ target" },
      smallDipBuy: { title: "Small dip buy", condition: "Exactly 1 low signal is on", operation: "Buy QQQ with up to 2x monthly contribution" },
      crashDefense: { title: "Fast-crash defense", condition: "25-day drop <= -12%, without low-signal convergence", operation: "Sell about 1/2 of TQQQ into cash" },
      trimHeat: { title: "Trim heat", condition: "Heat/quiet regime lasts 6+ months", operation: "Sell about 1/12 of TQQQ monthly, but keep a 20% floor" },
      pauseAtHigh: { title: "Pause at high", condition: "CAPE >= 70% and index is within 5% of its high", operation: "Do not buy QQQ/TQQQ; hold monthly cash" },
      normalDca: { title: "Normal DCA", condition: "No higher-priority rule fires", operation: "Refill the 20% TQQQ floor, then buy QQQ; drip cash at 1/6" },
    },
    chips: {
      valuationCheap: "Cheap valuation",
      deepDrawdown: "Deep drawdown",
      panicVix: "Panic VIX",
      valuationHigh: "Expensive",
      nearHigh: "Near high",
      fastCrash: "Fast crash",
      quietVix: "Too quiet",
    },
    strategies: {
      qqq: "QQQ DCA",
      tqqq: "TQQQ DCA",
      blend8020: "80% QQQ / 20% TQQQ DCA",
      signal: "Three-signal",
    },
    metricLabels: {
      finalValue: "Final value",
      multiple: "Multiple",
      irr: "IRR",
      maxDrawdown: "Max drawdown",
      regression: "Log-trend annualized",
    },
    meta: (data) => `Generated ${data.generatedAt}; CAPE date ${data.indicators.cape.date}; Nasdaq latest ${data.indicators.nasdaq100.date}; low signals ${data.decision.lowSignalCount}/3.`,
    capeNote: (cape) => `CAPE ${cape.value.toFixed(2)}; ${cape.historyCount} monthly observations.`,
    ddNote: (ndx) => `5-day average ${fmtNumber(ndx.level5dAvg, 0)}; 25-day change ${fmtPct(ndx.crash25dPct)}.`,
    vixNote: (vix) => `Latest ${vix.latest.toFixed(2)}; date ${vix.date}.`,
  },
};

let lang = "zh";
let marketData = null;
let backtestData = null;
let selected = new Set(["qqq", "blend8020", "signal"]);
let showActionMarkers = false;

function fmtPct(n, digits = 1) {
  return `${Number(n).toFixed(digits)}%`;
}

function fmtMoney(n) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function fmtNumber(n, digits = 1) {
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function setDot(id, cls) {
  const el = $(id);
  el.className = `dot ${cls}`;
}

function renderStatic() {
  const t = copy[lang];
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  $("eyebrow").textContent = t.eyebrow;
  $("title").textContent = t.title;
  $("subtitle").textContent = t.subtitle;
  $("refreshBtn").textContent = t.refresh;
  $("runBtn").textContent = t.run;
  $("decisionKicker").textContent = t.decisionKicker;
  $("capeLabel").textContent = t.capeLabel;
  $("ddLabel").textContent = t.ddLabel;
  $("vixLabel").textContent = t.vixLabel;
  $("methodKicker").textContent = t.methodKicker;
  $("methodTitle").textContent = t.methodTitle;
  $("actionCatalogKicker").textContent = t.actionCatalogKicker;
  $("actionCatalogTitle").textContent = t.actionCatalogTitle;
  $("actionCatalogNote").textContent = t.actionCatalogNote;
  $("backtestKicker").textContent = t.backtestKicker;
  $("backtestTitle").textContent = t.backtestTitle;
  $("startLabel").textContent = t.startLabel;
  $("monthlyLabel").textContent = t.monthlyLabel;
  $("trendLabel").textContent = t.trendLabel;
  $("actionsToggleBtn").textContent = showActionMarkers ? t.hideActionMarkersLabel : t.actionMarkersLabel;
  $("actionsToggleBtn").classList.toggle("active", showActionMarkers);
  $("backtestNote").textContent = t.backtestNote;
  $("zhBtn").classList.toggle("active", lang === "zh");
  $("enBtn").classList.toggle("active", lang === "en");

  $("methods").replaceChildren(...t.methods.map((item) => {
    const card = document.createElement("article");
    card.className = "method-card";
    card.innerHTML = `<h3>${item.title}</h3><p>${item.body}</p>`;
    return card;
  }));

  renderActionCatalog();
  renderActionLegend();
  if (!marketData) {
    $("action").textContent = t.loadingAction;
    $("operation").textContent = t.loadingOperation;
  }
  renderMarket();
  renderStrategyToggles();
  renderBacktest();
}

function renderActionCatalog() {
  const t = copy[lang];
  $("actionCatalog").replaceChildren(...actionOrder.map((key) => {
    const action = t.actions[key];
    const visual = actionVisuals[key];
    const card = document.createElement("article");
    card.className = "action-card";
    card.innerHTML = `
      <span class="action-icon" style="background:${visual.color}">${visual.icon}</span>
      <div>
        <h3>${action.title}</h3>
        <p class="condition">${action.condition}</p>
        <p>${action.operation}</p>
      </div>
    `;
    return card;
  }));
}

function renderActionLegend() {
  const t = copy[lang];
  $("actionLegend").hidden = !showActionMarkers;
  if (!showActionMarkers) return;
  $("actionLegend").replaceChildren(...actionOrder.map((key) => {
    const action = t.actions[key];
    const visual = actionVisuals[key];
    const item = document.createElement("span");
    item.className = "legend-item";
    item.innerHTML = `<span class="action-dot" style="background:${visual.color}">${visual.icon}</span><span>${action.title}</span>`;
    return item;
  }));
}

function chip(label, on) {
  const el = document.createElement("span");
  el.className = `chip${on ? " on" : ""}`;
  el.textContent = label;
  return el;
}

function renderMarket() {
  if (!marketData) return;
  const t = copy[lang];
  const { cape, nasdaq100, vix } = marketData.indicators;
  $("capeValue").textContent = fmtPct(cape.percentile);
  $("capeNote").textContent = t.capeNote(cape);
  setDot("capeDot", cape.percentile < 20 ? "green" : cape.percentile >= 70 ? "red" : "amber");

  $("ddValue").textContent = fmtPct(nasdaq100.drawdownPct);
  $("ddNote").textContent = t.ddNote(nasdaq100);
  setDot("ddDot", nasdaq100.drawdownPct <= -20 ? "green" : nasdaq100.crash25dPct <= -12 ? "red" : "amber");

  $("vixValue").textContent = fmtNumber(vix.value5dAvg, 1);
  $("vixNote").textContent = t.vixNote(vix);
  setDot("vixDot", vix.value5dAvg >= 40 ? "green" : vix.value5dAvg <= 12 ? "red" : "amber");

  const decision = marketData.decision;
  const text = t.decisions[decision.key];
  $("action").textContent = text[0];
  $("operation").textContent = text[1];
  $("risk").textContent = text[2];
  $("meta").textContent = t.meta(marketData);
  $("sources").innerHTML = `${t.sources}<a href="https://finance.yahoo.com/quote/%5ENDX/">Yahoo ^NDX</a>, <a href="https://finance.yahoo.com/quote/%5EVIX/">Yahoo ^VIX</a>, <a href="https://www.multpl.com/shiller-pe/table/by-month">Multpl Shiller PE</a>.`;

  $("chips").replaceChildren(
    chip(t.chips.valuationCheap, decision.lowSignals.valuationCheap),
    chip(t.chips.deepDrawdown, decision.lowSignals.deepDrawdown),
    chip(t.chips.panicVix, decision.lowSignals.panicVix),
    chip(t.chips.valuationHigh, decision.defensiveFlags.valuationHigh),
    chip(t.chips.nearHigh, decision.defensiveFlags.nearHigh),
    chip(t.chips.fastCrash, decision.defensiveFlags.fastCrash),
    chip(t.chips.quietVix, decision.defensiveFlags.quietVix),
  );
}

function renderStrategyToggles() {
  const t = copy[lang];
  $("strategyToggles").replaceChildren(...Object.keys(colors).map((key) => {
    const label = document.createElement("label");
    label.className = "strategy";
    label.innerHTML = `<input type="checkbox" ${selected.has(key) ? "checked" : ""} data-key="${key}" /><span class="swatch" style="background:${colors[key]}"></span><span>${t.strategies[key]}</span>`;
    return label;
  }));
  $("strategyToggles").querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", (event) => {
      const key = event.currentTarget.dataset.key;
      if (event.currentTarget.checked) selected.add(key);
      else selected.delete(key);
      renderBacktest();
    });
  });
}

function renderBacktest() {
  if (!backtestData) return;
  renderChart();
  renderActionStrip();
  const t = copy[lang];
  const cards = backtestData.strategies.map((strategy) => {
    const card = document.createElement("article");
    card.className = "metric-card";
    card.innerHTML = `
      <h3><span class="swatch" style="display:inline-block;background:${colors[strategy.key]}"></span> ${t.strategies[strategy.key]}</h3>
      <div class="metric-row"><span>${t.metricLabels.finalValue}</span><strong>${fmtMoney(strategy.finalValue)}</strong></div>
      <div class="metric-row"><span>${t.metricLabels.multiple}</span><strong>${fmtNumber(strategy.multiple, 2)}x</strong></div>
      <div class="metric-row"><span>${t.metricLabels.irr}</span><strong>${strategy.irr == null ? "--" : fmtPct(strategy.irr * 100)}</strong></div>
      <div class="metric-row"><span>${t.metricLabels.maxDrawdown}</span><strong>${fmtPct(strategy.maxDrawdown * 100)}</strong></div>
      <div class="metric-row"><span>${t.metricLabels.regression}</span><strong>${fmtPct(strategy.regression.annualized * 100)}</strong></div>
    `;
    return card;
  });
  $("metrics").replaceChildren(...cards);
}

function renderActionStrip() {
  $("actionStrip").hidden = !showActionMarkers || !backtestData;
  if (!showActionMarkers || !backtestData) return;
  const t = copy[lang];
  const signal = backtestData.strategies.find((strategy) => strategy.key === "signal");
  if (!signal) return;
  $("actionStrip").replaceChildren(...signal.points.map((point) => {
    const visual = actionVisuals[point.actionKey] || actionVisuals.normalDca;
    const action = t.actions[point.actionKey] || t.actions.normalDca;
    const button = document.createElement("button");
    button.className = "action-dot";
    button.type = "button";
    button.style.background = visual.color;
    button.textContent = visual.icon;
    button.title = `${point.date} · ${action.title} · ${action.operation}`;
    return button;
  }));
}

function chartBounds(strategies) {
  let max = 1;
  for (const strategy of strategies) {
    for (const point of strategy.points) max = Math.max(max, point.value);
    if ($("trendInput").checked) {
      for (const point of strategy.points) {
        const y = Math.exp(strategy.regression.intercept + strategy.regression.slope * point.year);
        max = Math.max(max, y);
      }
    }
  }
  return { min: 0, max: max * 1.08 };
}

function renderChart() {
  const canvas = $("equityChart");
  const wrap = canvas.parentElement;
  const rect = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(640, Math.floor(rect.width * dpr));
  canvas.height = Math.max(320, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const pad = { left: 96, right: 24, top: 24, bottom: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  ctx.clearRect(0, 0, width, height);

  const strategies = backtestData.strategies.filter((strategy) => selected.has(strategy.key));
  if (!strategies.length) return;
  const bounds = chartBounds(strategies);
  const pointCount = strategies[0].points.length;
  const xFor = (i) => pad.left + (pointCount <= 1 ? 0 : i / (pointCount - 1)) * plotW;
  const yFor = (value) => pad.top + plotH - (value - bounds.min) / (bounds.max - bounds.min) * plotH;

  ctx.strokeStyle = "#d4dbe5";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH * i) / 4;
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
  }
  ctx.stroke();

  ctx.fillStyle = "#667085";
  ctx.font = "12px ui-sans-serif, system-ui";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i += 1) {
    const value = bounds.max - ((bounds.max - bounds.min) * i) / 4;
    ctx.fillText(fmtMoney(value), pad.left - 10, pad.top + (plotH * i) / 4);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const labels = [0, Math.floor((pointCount - 1) / 2), pointCount - 1];
  for (const i of labels) {
    const date = strategies[0].points[i]?.date || "";
    ctx.fillText(date.slice(0, 4), xFor(i), height - pad.bottom + 14);
  }

  for (const strategy of strategies) {
    ctx.strokeStyle = colors[strategy.key];
    ctx.lineWidth = 2.4;
    ctx.setLineDash([]);
    ctx.beginPath();
    strategy.points.forEach((point, i) => {
      const x = xFor(i);
      const y = yFor(point.value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    if ($("trendInput").checked) {
      ctx.lineWidth = 1.4;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      strategy.points.forEach((point, i) => {
        const yValue = Math.exp(strategy.regression.intercept + strategy.regression.slope * point.year);
        const x = xFor(i);
        const y = yFor(yValue);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (showActionMarkers && selected.has("signal")) {
    const signal = backtestData.strategies.find((strategy) => strategy.key === "signal");
    if (signal) {
      const markerY = height - pad.bottom - 9;
      signal.points.forEach((point, i) => {
        const visual = actionVisuals[point.actionKey] || actionVisuals.normalDca;
        const x = xFor(i);
        ctx.fillStyle = visual.color;
        ctx.beginPath();
        ctx.arc(x, markerY, 4, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  canvas.onmousemove = (event) => {
    const chartRect = canvas.getBoundingClientRect();
    const x = event.clientX - chartRect.left;
    if (x < pad.left || x > width - pad.right) {
      $("tooltip").hidden = true;
      return;
    }
    const index = Math.max(0, Math.min(pointCount - 1, Math.round(((x - pad.left) / plotW) * (pointCount - 1))));
    const signalPoint = backtestData.strategies.find((strategy) => strategy.key === "signal")?.points[index];
    const action = signalPoint?.actionKey ? copy[lang].actions[signalPoint.actionKey] : null;
    const actionRow = showActionMarkers && action ? `<div><strong>${copy[lang].strategies.signal}</strong>: ${action.title}</div>` : "";
    const rows = strategies.map((strategy) => {
      const point = strategy.points[index];
      return `<div><span style="color:${colors[strategy.key]}">●</span> ${copy[lang].strategies[strategy.key]}: <strong>${fmtMoney(point.value)}</strong></div>`;
    }).join("");
    const tip = $("tooltip");
    tip.innerHTML = `<strong>${strategies[0].points[index].date}</strong>${actionRow}${rows}`;
    tip.hidden = false;
    tip.style.left = `${Math.min(width - 300, Math.max(8, x + 14))}px`;
    tip.style.top = `${Math.max(8, event.clientY - chartRect.top - 20)}px`;
  };
  canvas.onmouseleave = () => { $("tooltip").hidden = true; };
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function loadMarket() {
  marketData = await fetchJson("/api/market");
  renderMarket();
}

async function loadBacktest() {
  const start = $("startInput").value;
  const monthly = $("monthlyInput").value;
  backtestData = await fetchJson(`/api/backtest?start=${encodeURIComponent(start)}&monthly=${encodeURIComponent(monthly)}`);
  renderBacktest();
}

async function loadAll() {
  $("error").hidden = true;
  $("refreshBtn").disabled = true;
  $("runBtn").disabled = true;
  const results = await Promise.allSettled([loadMarket(), loadBacktest()]);
  const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason.message);
  if (errors.length) {
    $("error").hidden = false;
    $("error").textContent = `${copy[lang].error}${errors.join(" / ")}`;
  }
  $("refreshBtn").disabled = false;
  $("runBtn").disabled = false;
}

$("zhBtn").addEventListener("click", () => { lang = "zh"; renderStatic(); });
$("enBtn").addEventListener("click", () => { lang = "en"; renderStatic(); });
$("refreshBtn").addEventListener("click", loadAll);
$("runBtn").addEventListener("click", loadBacktest);
$("trendInput").addEventListener("change", renderBacktest);
$("actionsToggleBtn").addEventListener("click", () => {
  showActionMarkers = !showActionMarkers;
  const t = copy[lang];
  $("actionsToggleBtn").textContent = showActionMarkers ? t.hideActionMarkersLabel : t.actionMarkersLabel;
  $("actionsToggleBtn").classList.toggle("active", showActionMarkers);
  renderActionLegend();
  renderBacktest();
});
window.addEventListener("resize", () => { if (backtestData) renderChart(); });

renderStatic();
loadAll();
