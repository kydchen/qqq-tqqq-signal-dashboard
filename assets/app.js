const $ = (id) => document.getElementById(id);

const colors = {
  qqq: "#1d4ed8",
  tqqq: "#b42318",
  blend8020: "#0f766e",
  signal: "#6d28d9",
  signalQqq: "#0f766e",
  signalTqqq: "#f97316",
};

const visibleStrategyKeys = ["qqq", "signalQqq", "tqqq", "signalTqqq", "signal"];
const visibleStrategySet = new Set(visibleStrategyKeys);
const actionOrder = ["bottomAttack", "rampTqqq", "smallDipBuy", "crashDefense", "trimHeat", "pauseAtHigh", "normalDca"];
const guideStrategyKeys = { qqqOnly: "signalQqq", tqqqOnly: "signalTqqq" };
const actionVisuals = {
  bottomAttack: { icon: "T", color: "#b42318" },
  rampTqqq: { icon: "T+", color: "#dc2626" },
  smallDipBuy: { icon: "Q+", color: "#0f766e" },
  crashDefense: { icon: "1/2", color: "#7f1d1d" },
  trimHeat: { icon: "-T", color: "#b45309" },
  pauseAtHigh: { icon: "$", color: "#475467" },
  normalDca: { icon: "Q", color: "#1d4ed8" },
};
const workbenchViews = ["positions", "events", "attribution", "validation", "data"];
const DEFAULT_RULE_THRESHOLDS = Object.freeze({
  cheapCape: 35,
  supportCape: 50,
  supportDrawdown: -25,
  highCape: 70,
  bubbleCape: 85,
  deepDrawdown: -20,
  mildDrawdown: -12,
  fastCrash: -12,
  panicVix: 32,
  quietVix: 12,
});

const copy = {
  zh: {
    eyebrow: "QQQ / TQQQ",
    title: "纳指三信号仪表盘",
    subtitle: "用估值、回撤和波动率，决定本月买 QQQ、买 TQQQ、暂停，还是减 TQQQ。面向月度定投流程，不是日内交易系统。",
    decisionKicker: "本月有效动作",
    loadingAction: "加载中",
    loadingOperation: "正在拉取市场数据。",
    refreshData: "刷新数据",
    refreshingData: "刷新中...",
    confidenceLabel: "信号强度",
    confidenceLevels: { high: "高", medium: "中", low: "低" },
    lockedLabel: "月初锁定",
    liveLabel: "今日预览",
    upgradeLabel: "月内升级",
    upgradeYes: "是",
    upgradeNo: "否",
    edgeKicker: "真实 TQQQ 样本证据",
    edgeEmpty: "回测加载后显示历史相对优势。",
    edgeNote: (h) => `${fmtDate(h.scopeStart)} 起仅使用真实 TQQQ 历史。三信号期末约为 QQQ 的 ${fmtNumber(h.signalVsQqq?.finalRelativeMultiple || 0, 2)} 倍；相对按平均现金、QQQ、TQQQ 权重月度再平衡的静态组合为 ${fmtNumber(h.allocationMatched?.signalVsStatic?.finalRelativeMultiple || 0, 2)} 倍。`,
    edgeStats: {
      multiple: "相对 QQQ",
      allocationMatched: "相对均仓静态",
      relativeDrawdown: "最大相对回撤",
      underwater: "最长相对落后",
    },
    disclaimer: "私人研究与手动执行工具，不是投资建议。订单只是下一交易时段的金额草稿，不会自动下单。历史相对优势不保证未来重复；TQQQ 可能出现极深回撤。",
    execution: {
      kicker: "手动执行",
      title: "把本月动作换算成订单草稿",
      note: "持仓、风险档和执行记录只保存在当前浏览器。系统使用最新收盘信号，订单按下一交易时段准备。",
      localOnly: "仅存此浏览器",
      riskProfile: "风险档",
      cash: "现有现金（USD）",
      qqqShares: "QQQ 份额",
      tqqqShares: "TQQQ 份额",
      monthly: "本月可投入（USD）",
      cost: "订单单边摩擦",
      fractional: "支持碎股",
      profiles: {
        conservative: ["保守", "只使用 QQQ 和现金；已有 TQQQ 会在草稿中降到 0%。"],
        standard: ["标准", "TQQQ 月度检查上限 40%，常态地板 10%，大底后最高 40%。"],
        aggressive: ["进攻", "沿用主策略：TQQQ 月度检查上限 90%，常态地板 20%。"],
      },
      plan: "生成订单草稿",
      clear: "清除本地数据",
      nextSession: "下一交易时段",
      emptyTitle: "尚未生成订单",
      waiting: "待输入",
      ready: "可手动核对",
      blocked: "数据未就绪",
      noTrade: "本月不需要买卖；新增资金保留现金。",
      retainedCash: "计划后现金",
      floorGap: "距 TQQQ 地板",
      estimatedCost: "估算摩擦",
      quote: "报价日期",
      ruleset: "规则版本",
      calendar: "导出月初日历",
      record: "记录本月计划",
      recorded: "已记录",
      actualNote: "实际执行备注",
      actualPlaceholder: "例如：按草稿买入；或说明未执行原因",
      journalKicker: "本地记录",
      journalTitle: "最近执行记录",
      journalEmpty: "还没有记录。生成草稿后可保存本月计划与实际执行备注。",
      clearJournal: "清空记录",
      buy: "买入",
      sell: "卖出",
      savedError: "浏览器拒绝了本地存储；订单仍可计算，但无法保存。",
      marketExpired: "行情快照已超过 30 分钟，请刷新数据后重新生成草稿。",
    },
    historyKicker: "动作轨迹",
    historyTitle: "近月有效动作",
    historyNote: "标记表示月内发生过动作升级。信号在收盘后确认，手动订单统一放到下一交易时段。",
    upgradedMark: "升",
    capeLabel: "CAPE 分位",
    ddLabel: "纳指 100 回撤",
    vixLabel: "VIX 5 日均值",
    historyLabels: {
      cape: "近 12 个月（月频）",
      nasdaq100: "近 5 个交易日",
      vix: "近 5 个交易日",
    },
    statusLabels: {
      cheap: "便宜",
      expensive: "高估",
      neutral: "中性",
      deep: "深跌",
      mild: "浅跌",
      fastCrash: "快崩",
      normal: "常态",
      panic: "恐慌",
      lowVol: "低波动",
    },
    methodKicker: "计算方法",
    methodTitle: "三类信号，月初入金、月内可升级",
    actionCatalogKicker: "动作清单",
    actionCatalogTitle: "三信号策略会做什么",
    actionCatalogNote: "优先级：大底 > 大底后加速 > 小底 > 快崩风控 > 过热锁利 > 高位暂停 > 正常定投。快崩只在没有核心低位信号时卖出。单纯低波动不再触发暂停。",
    guideKicker: "执行框架",
    guideTitle: "同一组三信号，两张单标的参考卡",
    guideNote: "战术 QQQ / 战术 TQQQ 是单标的参考，不改变顶部混合策略建议。回测里战术 QQQ 常略逊于纯 QQQ 定投，因为它用暂停和减仓换更低回撤。",
    guideStatsFinal: "期末资产",
    guideStatsDrawdown: "最大回撤",
    guideReferenceNote: "参考用法，不改变顶部三信号 QQQ/TQQQ 主策略建议。",
    backtestKicker: "收益回测",
    backtestTitle: "比较不同定投方式",
    sensitivityTitle: "参数敏感性",
    sensitivityNote: "三信号策略用深跌阈值和恐慌 VIX 阈值做 ±20% 网格重跑。",
    startLabel: "起始时间",
    monthlyFixedLabel: "每月固定投入",
    costLabel: "单边交易摩擦",
    trendLabel: "显示单位净值趋势线",
    scaleLabel: "对数纵轴",
    qqqAxisLabel: "右轴显示 QQQ 价格",
    actionMarkersLabel: "浮窗显示月度动作",
    backtestNote: "回测固定每月 $1,000，使用版本化本地数据快照。信号在收盘后确认，下一交易时段执行；交易摩擦可切换。图表仍可查看合成历史，但顶部主结论只使用真实 TQQQ 样本。",
    workbenchTitle: "策略工作台",
    exportCsv: "导出 CSV",
    copyLink: "复制链接",
    linkCopied: "已复制",
    tabs: {
      positions: "仓位",
      events: "事件复盘",
      attribution: "动作归因",
      validation: "稳健性",
      data: "数据质量",
    },
    workbench: {
      latestWeights: "最新仓位",
      weightsChart: "三信号策略仓位变化",
      cash: "现金",
      qqq: "QQQ",
      tqqq: "TQQQ",
      latestAction: "最近动作",
      syntheticTqqq: "TQQQ 早期为合成数据",
      eventsTitle: "典型市场阶段表现",
      eventsEmpty: "当前起始时间没有完整的事件复盘窗口。",
      period: "区间",
      signalReturn: "三信号",
      qqqReturn: "QQQ",
      drawdown: "净值回撤",
      topActions: "主要动作",
      attributionTitle: "动作月度贡献估算（含市场 beta，非因果）",
      drag: "拖累",
      gain: "贡献",
      months: "月份",
      estimatedPnl: "估算贡献",
      validationTitle: "Walk-forward 参数验证（按风险调整超额选参）",
      noValidation: "这个起始年份之后样本太短，暂无可用验证切分。",
      split: "切分点",
      bestThresholds: "训练期最佳阈值",
      trained: "训练期",
      validation: "验证期",
      defaultRule: "默认规则",
      vsQqq: "验证期/QQQ",
      dataTitle: "数据覆盖与模型口径",
      coverage: "覆盖",
      observations: "条",
      stale: "当前使用快照兜底",
      fresh: "实时/快照数据可用",
      modelNotes: "模型说明",
      actualStart: "真实数据起点",
      syntheticEnd: "合成数据截至",
    },
    events: {
      dotcom: "互联网泡沫",
      gfc: "全球金融危机",
      covid: "2020 疫情冲击",
      rate2022: "2022 加息杀估值",
      ai2023: "AI 牛市",
      tariff2025: "2025 关税冲击",
    },
    sources: "数据源：",
    error: "数据加载失败：",
    errorTitle: "数据暂时不可用",
    loadingBacktest: "正在更新回测...",
    emptyChart: "没有可显示的数据。请换一个起始年份。",
    emptySelection: "请至少选择一条策略线。",
    historyEmpty: "当前窗口没有可显示的月度动作。",
    methods: [
      {
        title: "估值：CAPE 历史分位",
        body: (thr) => `CAPE 是标普宽基 Shiller PE，不是纳指精确估值。滚动 30 年分位低于 ${thr.cheapCape}% 记为便宜；若分位低于 ${thr.supportCape}% 且纳指已深跌 ${Math.abs(thr.supportDrawdown)}%+，也记为估值支持。高于 ${thr.highCape}% 高估，高于 ${thr.bubbleCape}% 泡沫警戒。`
      },
      {
        title: "趋势：回撤与快崩",
        body: (thr) => `纳指 100 的 5 日均线相对约 5 年高点算回撤。深跌 ≤ ${thr.deepDrawdown}%，浅跌 ≤ ${thr.mildDrawdown}%。25 日跌幅 ≤ ${thr.fastCrash}% 为快崩。只有在没有核心低位信号时，快崩才触发卖出。`
      },
      {
        title: "恐慌：VIX 5 日均值",
        body: (thr) => `VIX 是标普隐含波动，用作跨资产恐慌代理。5 日均值 ≥ ${thr.panicVix} 记为恐慌。低波动（≤ ${thr.quietVix}）只作提示，不再单独触发暂停或锁利。`
      }
    ],
    decisions: {
      bottomAttack: ["大底进攻", "先用约 1/3 现金仓买 TQQQ；随后 6 个月继续把组合里的 TQQQ 提到约 90%。", "至少两个低位信号共振时触发。路径风险高，只适合能承受大幅回撤的仓位。"],
      rampTqqq: ["大底后加速", "继续用当月资金和部分现金买 TQQQ；不足 90% 时可把部分 QQQ 换成 TQQQ。", "这是大底后的 6 个月执行窗口，不是新的抄底信号。"],
      smallDipBuy: ["小底加仓", "最多用 2 倍月投入买 QQQ；多余现金继续等待更强信号。", "单个低位信号或浅跌区，加仓但不梭哈。"],
      crashDefense: ["快崩风控", "卖出约一半 TQQQ；当月新增资金不买 QQQ/TQQQ，留现金。", "只在没有核心低位信号时启用，历史触发极少；它是机械护栏，不是已充分验证的保护。"],
      pauseAtHigh: ["高位暂停", "本月暂停新增 QQQ/TQQQ 买入，新增资金进入现金仓。", "高估且贴近新高，或进入泡沫警戒时，耐心优于追涨。"],
      trimHeat: ["过热锁利", "卖出约 1/12 TQQQ，但保留 20% TQQQ 底仓；当月新增资金不买 QQQ/TQQQ，留现金。", "泡沫级估值持续 6 个月以上才锁利，不是普通牛市的例行减仓。"],
      normalDca: ["正常定投", "如果 TQQQ 低于组合 20%，先用当月资金和现金补买 TQQQ；补足后剩余资金买 QQQ。现金仓每月最多拿 1/6 补买 QQQ。", "没有低位信号时，只保留小杠杆底仓，不主动追高。"],
    },
    actions: {
      bottomAttack: { title: "大底进攻", condition: "2-3 个低位信号同时亮（可月内升级）", operation: "先用约 1/3 现金仓买 TQQQ，剩余现金留给后续 6 个月" },
      rampTqqq: { title: "大底后加速", condition: "大底进攻后的 6 个月", operation: "用当月 $1,000 和约 1/6 现金继续买 TQQQ；还不够 90% 时，卖出一部分 QQQ 换成 TQQQ" },
      smallDipBuy: { title: "小底加仓", condition: (thr) => `1 个核心低位信号，或浅跌 ≤ ${thr.mildDrawdown}%`, operation: "最多 2x 月投入买 QQQ" },
      crashDefense: { title: "快崩风控", condition: (thr) => `25 日跌幅 ≤ ${thr.fastCrash}%，且没有核心低位信号`, operation: "卖出约 1/2 TQQQ；当月不买 QQQ/TQQQ，留现金" },
      trimHeat: { title: "过热锁利", condition: "CAPE 泡沫警戒持续 6 个月以上", operation: "卖出约 1/12 TQQQ；当月不买 QQQ/TQQQ，留现金" },
      pauseAtHigh: { title: "高位暂停", condition: (thr) => `CAPE ≥ ${thr.highCape}% 且距高点 < 5%，或达到 ${thr.bubbleCape}% 泡沫警戒`, operation: "不买 QQQ/TQQQ，当月资金留现金" },
      normalDca: { title: "正常定投", condition: "没有触发以上任何动作", operation: "TQQQ 不到 20% 就先买 TQQQ；够了以后买 QQQ，现金仓每月拿 1/6 买回 QQQ" },
    },
    guides: {
      qqqOnly: {
        badge: "Q",
        title: "战术 QQQ",
        body: "把信号当成 QQQ 买卖节奏器：低位和常态买回 QQQ，高位暂停，快崩和过热时卖出一部分 QQQ 留现金。",
        rule: "适合想降低追高风险、但不想碰杠杆 ETF 的账户。",
        actions: {
          bottomAttack: "用当月资金和约 1/3 现金仓加买 QQQ。",
          rampTqqq: "大底后的 6 个月继续用现金仓分批买 QQQ。",
          smallDipBuy: "最多用 2x 月投入买 QQQ。",
          crashDefense: "卖出约 1/4 QQQ，当月资金留现金，等低位信号确认。",
          trimHeat: "卖出约 1/12 QQQ，当月资金留现金。",
          pauseAtHigh: "暂停买 QQQ，当月资金留现金。",
          normalDca: "买 QQQ；若之前攒了现金，每月最多拿 1/6 补回。",
        },
      },
      mixed: {
        badge: "Q/T",
        title: "QQQ/TQQQ 混合仓",
        body: "用 QQQ 做主仓，TQQQ 只在低位承担进攻角色；高位和快崩时允许卖 TQQQ、留现金。",
        rule: "适合愿意用少量杠杆换更高弹性，但仍重视回撤控制的账户。",
        actions: {
          bottomAttack: "现金仓分批买 TQQQ，后续 6 个月把 TQQQ 提到约 90%。",
          rampTqqq: "继续买 TQQQ，必要时卖一部分 QQQ 换 TQQQ。",
          smallDipBuy: "最多用 2x 月投入买 QQQ。",
          crashDefense: "卖出约 1/2 TQQQ，当月资金留现金。",
          trimHeat: "卖出约 1/12 TQQQ，但保留 20% TQQQ 底仓。",
          pauseAtHigh: "暂停买 QQQ/TQQQ，当月资金留现金。",
          normalDca: "先补 20% TQQQ 底仓，够了以后买 QQQ。",
        },
      },
      tqqqOnly: {
        badge: "T",
        title: "战术 TQQQ",
        body: "信号在这里更像风控开关：低位买、常态小步买，高位暂停，快崩和过热时卖出一部分 TQQQ。",
        rule: "只适合能承受大幅回撤、并接受长期现金等待的高风险账户。",
        actions: {
          bottomAttack: "用当月资金和约 1/3 现金仓买 TQQQ。",
          rampTqqq: "大底后的 6 个月继续分批买 TQQQ。",
          smallDipBuy: "只用当月资金买 TQQQ，不做 2x 加仓。",
          crashDefense: "卖出约 1/2 TQQQ，当月资金留现金。",
          trimHeat: "卖出约 1/12 TQQQ，当月资金留现金。",
          pauseAtHigh: "暂停买 TQQQ，当月资金留现金。",
          normalDca: "买 TQQQ；若之前攒了现金，每月最多拿 1/6 补回。",
        },
      },
    },
    chips: {
      valuationCheap: "估值便宜",
      deepDrawdown: "深度回撤",
      panicVix: "VIX 恐慌",
      valuationHigh: "高估",
      nearHigh: "贴近新高",
      fastCrash: "快崩",
      quietVix: "低波动",
    },
    strategies: {
      qqq: "QQQ 定投",
      tqqq: "TQQQ 定投",
      blend8020: "新增资金 80/20（不再平衡）",
      signal: "三信号 QQQ/TQQQ 策略",
      signalQqq: "战术 QQQ",
      signalTqqq: "战术 TQQQ",
    },
    metricLabels: {
      finalValue: "期末资产",
      multiple: "投入倍数",
      irr: "IRR",
      maxDrawdown: "净值最大回撤",
      regression: "单位净值趋势年化",
      sharpe: "超额收益 Sharpe",
      ulcer: "Ulcer",
      bottomAttack: "大底次数",
      shortSample: "样本太短",
    },
    meta: (data) => `生成时间 ${fmtDateTime(data.generatedAt)}；规则 ${data.rulesetId || "--"}；数据 ${data.dataSnapshotId || "--"}；纳指最新 ${fmtDate(data.indicators.nasdaq100.date)}；低位信号 ${data.decision.lowSignalCount}/3。${data.staleSources?.length ? ` 过期：${localizedSources(data.staleSources).join("、")}。` : ""}${data.fallbackSources?.length ? ` 新鲜快照兜底：${localizedSources(data.fallbackSources).join("、")}。` : ""}`,
    capeNote: (cape) => `CAPE ${cape.value.toFixed(2)}；滚动样本 ${cape.rollingMonths || 360} 个月；便宜上次 ${cape.lastCheap?.label || "无"}。`,
    ddNote: (ndx) => `5 日均值 ${fmtNumber(ndx.level5dAvg, 0)}；25 日变化 ${fmtPct(ndx.crash25dPct)}。`,
    vixNote: (vix) => `最新 ${vix.latest.toFixed(2)}；日期 ${vix.date}。`,
  },
  en: {
    eyebrow: "QQQ / TQQQ",
    title: "Nasdaq Three-Signal Dashboard",
    subtitle: "Use valuation, drawdown, and volatility to decide whether to buy QQQ, buy TQQQ, pause, or trim TQQQ this month. Built for monthly DCA process control, not day trading.",
    decisionKicker: "Effective month action",
    loadingAction: "Loading",
    loadingOperation: "Fetching market data.",
    refreshData: "Refresh data",
    refreshingData: "Refreshing...",
    confidenceLabel: "Rule strength",
    confidenceLevels: { high: "High", medium: "Med", low: "Low" },
    lockedLabel: "Month-open lock",
    liveLabel: "Live preview",
    upgradeLabel: "Intra-month upgrade",
    upgradeYes: "Yes",
    upgradeNo: "No",
    edgeKicker: "Real-TQQQ evidence",
    edgeEmpty: "Historical edge appears after the backtest loads.",
    edgeNote: (h) => `Uses actual TQQQ history from ${fmtDate(h.scopeStart)}. The three-signal book ends at ${fmtNumber(h.signalVsQqq?.finalRelativeMultiple || 0, 2)}x QQQ and ${fmtNumber(h.allocationMatched?.signalVsStatic?.finalRelativeMultiple || 0, 2)}x a static mix rebalanced to its average cash, QQQ, and TQQQ weights.`,
    edgeStats: {
      multiple: "Vs QQQ",
      allocationMatched: "Vs avg allocation",
      relativeDrawdown: "Max relative drawdown",
      underwater: "Longest underwater",
    },
    disclaimer: "Private research and manual-execution tool, not investment advice. Orders are next-session drafts and are never sent to a broker. Historical edge may fail; TQQQ can suffer extremely deep drawdowns.",
    execution: {
      kicker: "Manual execution",
      title: "Turn this month's action into an order draft",
      note: "Holdings, risk policy, and records stay in this browser. The signal uses the latest close; the draft is for the next trading session.",
      localOnly: "Stored in this browser",
      riskProfile: "Risk policy",
      cash: "Cash (USD)",
      qqqShares: "QQQ shares",
      tqqqShares: "TQQQ shares",
      monthly: "Available this month (USD)",
      cost: "Order friction, one way",
      fractional: "Fractional shares supported",
      profiles: {
        conservative: ["Conservative", "QQQ and cash only; the draft reduces any existing TQQQ to 0%."],
        standard: ["Standard", "TQQQ monthly-review cap 40%, normal floor 10%, post-bottom cap 40%."],
        aggressive: ["Aggressive", "Current main policy: TQQQ monthly-review cap 90% and normal floor 20%."],
      },
      plan: "Build order draft",
      clear: "Clear local data",
      nextSession: "Next trading session",
      emptyTitle: "No order draft yet",
      waiting: "Waiting",
      ready: "Ready to review",
      blocked: "Data not ready",
      noTrade: "No trade is required this month; keep the new cash uninvested.",
      retainedCash: "Cash after plan",
      floorGap: "TQQQ floor gap",
      estimatedCost: "Estimated friction",
      quote: "Quote date",
      ruleset: "Ruleset",
      calendar: "Export month-open calendar",
      record: "Record monthly plan",
      recorded: "Recorded",
      actualNote: "Actual execution note",
      actualPlaceholder: "For example: followed the draft, or why no trade was made",
      journalKicker: "Local journal",
      journalTitle: "Recent execution records",
      journalEmpty: "No records yet. Build a draft to save the monthly plan and your actual execution note.",
      clearJournal: "Clear records",
      buy: "Buy",
      sell: "Sell",
      savedError: "This browser blocked local storage. Orders still calculate but cannot be saved.",
      marketExpired: "The market snapshot is more than 30 minutes old. Refresh data before rebuilding the draft.",
    },
    historyKicker: "Action path",
    historyTitle: "Recent effective actions",
    historyNote: "A mark means the action upgraded during the month. Signals are confirmed after the close and manual orders use the next trading session.",
    upgradedMark: "up",
    capeLabel: "CAPE percentile",
    ddLabel: "Nasdaq-100 drawdown",
    vixLabel: "VIX 5-day average",
    historyLabels: {
      cape: "Last 12 months, monthly",
      nasdaq100: "Last 5 trading days",
      vix: "Last 5 trading days",
    },
    statusLabels: {
      cheap: "Cheap",
      expensive: "Expensive",
      neutral: "Neutral",
      deep: "Deep drop",
      mild: "Mild drop",
      fastCrash: "Fast crash",
      normal: "Normal",
      panic: "Panic",
      lowVol: "Low vol",
    },
    methodKicker: "Method",
    methodTitle: "Three signals, month-open funding, intra-month upgrades",
    actionCatalogKicker: "Action list",
    actionCatalogTitle: "What the signal strategy can do",
    actionCatalogNote: "Priority: bottom attack > post-bottom ramp > small dip > fast-crash defense > heat trim > pause at high > normal DCA. Fast-crash sells only when no core low signal is on. Quiet VIX alone no longer forces a pause.",
    guideKicker: "Execution modes",
    guideTitle: "One signal set, two single-ETF references",
    guideNote: "Tactical QQQ / Tactical TQQQ are references only. In backtests, Tactical QQQ often slightly trails plain QQQ DCA because pauses and trims buy lower path risk with less bull-market capture.",
    guideStatsFinal: "Final value",
    guideStatsDrawdown: "Max drawdown",
    guideReferenceNote: "Reference mode only; it does not change the top three-signal QQQ/TQQQ recommendation.",
    backtestKicker: "Return backtest",
    backtestTitle: "Compare DCA variants",
    sensitivityTitle: "Parameter sensitivity",
    sensitivityNote: "The signal strategy is rerun on a +/-20% grid for deep-drawdown and panic-VIX thresholds.",
    startLabel: "Start date",
    monthlyFixedLabel: "Fixed monthly buy",
    costLabel: "One-way trading friction",
    trendLabel: "Show unit-NAV trend",
    scaleLabel: "Log y-axis",
    qqqAxisLabel: "Show QQQ price axis",
    actionMarkersLabel: "Show actions in tooltip",
    backtestNote: "Backtests use a fixed $1,000 monthly contribution and versioned local snapshots. Signals are known after the close and execute next session; trading friction is selectable. The chart can still show synthetic history, but the headline only uses actual TQQQ history.",
    workbenchTitle: "Strategy workbench",
    exportCsv: "Export CSV",
    copyLink: "Copy link",
    linkCopied: "Copied",
    tabs: {
      positions: "Positions",
      events: "Events",
      attribution: "Attribution",
      validation: "Validation",
      data: "Data quality",
    },
    workbench: {
      latestWeights: "Latest weights",
      weightsChart: "Three-signal position history",
      cash: "Cash",
      qqq: "QQQ",
      tqqq: "TQQQ",
      latestAction: "Latest action",
      syntheticTqqq: "Early TQQQ range is synthetic",
      eventsTitle: "Key market regimes",
      eventsEmpty: "No complete event window is available for this start date.",
      period: "Period",
      signalReturn: "Three-signal",
      qqqReturn: "QQQ",
      drawdown: "NAV drawdown",
      topActions: "Main actions",
      attributionTitle: "Estimated monthly action contribution (includes market beta)",
      drag: "Drag",
      gain: "Gain",
      months: "Months",
      estimatedPnl: "Estimated PnL",
      validationTitle: "Walk-forward validation (risk-adjusted excess selection)",
      noValidation: "This start year leaves too little forward sample for validation splits.",
      split: "Split",
      bestThresholds: "Best train thresholds",
      trained: "Train",
      validation: "Validation",
      defaultRule: "Default rule",
      vsQqq: "OOS / QQQ",
      dataTitle: "Coverage and model assumptions",
      coverage: "Coverage",
      observations: "obs",
      stale: "Using snapshot fallback",
      fresh: "Live/snapshot data available",
      modelNotes: "Model notes",
      actualStart: "Actual data starts",
      syntheticEnd: "Synthetic through",
    },
    events: {
      dotcom: "Dot-com bust",
      gfc: "Global financial crisis",
      covid: "2020 Covid shock",
      rate2022: "2022 rate reset",
      ai2023: "AI bull market",
      tariff2025: "2025 tariff shock",
    },
    sources: "Sources: ",
    error: "Data load failed: ",
    errorTitle: "Data unavailable",
    loadingBacktest: "Updating backtest...",
    emptyChart: "No chart data is available. Pick another start year.",
    emptySelection: "Select at least one strategy line.",
    historyEmpty: "No monthly actions are available for this window.",
    methods: [
      {
        title: "Valuation: CAPE percentile",
        body: (thr) => `CAPE is S&P Shiller PE, not a precise Nasdaq valuation. Below the ${thr.cheapCape}th rolling 30-year percentile counts as cheap. Below the ${thr.supportCape}th percentile with a Nasdaq-100 drawdown of ${Math.abs(thr.supportDrawdown)}%+ also counts as valuation support. Above ${thr.highCape}% is expensive; above ${thr.bubbleCape}% is bubble watch.`
      },
      {
        title: "Trend: drawdown and fast crash",
        body: (thr) => `Nasdaq-100 5-day averages versus a rolling 5-year high define drawdown. Deep is <= ${thr.deepDrawdown}%, mild is <= ${thr.mildDrawdown}%. A 25-day drop <= ${thr.fastCrash}% is a fast crash. Fast-crash selling only fires when no core low signal is active.`
      },
      {
        title: "Fear: VIX 5-day average",
        body: (thr) => `VIX is S&P implied vol, used as a cross-asset panic proxy. A 5-day average at or above ${thr.panicVix} counts as panic. Quiet vol (<= ${thr.quietVix}) is informational only and no longer forces pause or trim by itself.`
      }
    ],
    decisions: {
      bottomAttack: ["Bottom attack", "Deploy about 1/3 of cash into TQQQ, then spend 6 months lifting TQQQ toward about 90% of the portfolio.", "Needs at least two low signals. Path risk is high; size only what you can hold through a severe drawdown."],
      rampTqqq: ["Post-bottom ramp", "Keep buying TQQQ with monthly cash and part of saved cash. If still below 90%, rotate some QQQ into TQQQ.", "This is the 6-month execution window after a bottom attack, not a fresh bottom call."],
      smallDipBuy: ["Small dip buy", "Buy QQQ with up to 2x the monthly contribution; keep excess cash for stronger signals.", "One low signal or a mild drawdown. Add, do not all-in."],
      crashDefense: ["Fast-crash defense", "Sell about half of TQQQ into cash. New monthly cash does not buy QQQ/TQQQ.", "Only when no core low signal is on. Historical triggers are rare; this is a mechanical guardrail, not a well-validated protection claim."],
      pauseAtHigh: ["Pause at high", "Pause new QQQ/TQQQ buying this month. Route new money to cash.", "Expensive near the high, or bubble watch. Patience beats chase."],
      trimHeat: ["Trim heat", "Sell about 1/12 of TQQQ, keep a 20% TQQQ floor, and keep new monthly cash in cash.", "Only after bubble-level CAPE has lasted 6+ months. Not a routine bull-market sell."],
      normalDca: ["Normal DCA", "If TQQQ is below 20% of the portfolio, use monthly money and cash to buy TQQQ first. After that, buy QQQ. Each month, use up to 1/6 of extra cash to buy QQQ.", "Without low signals, keep only a small leverage floor instead of chasing."],
    },
    actions: {
      bottomAttack: { title: "Bottom attack", condition: "2-3 low signals on (can upgrade mid-month)", operation: "Deploy about 1/3 of cash into TQQQ; keep the rest for the next 6 months" },
      rampTqqq: { title: "Post-bottom ramp", condition: "6 months after a bottom attack", operation: "Use the monthly $1,000 and about 1/6 of cash to buy TQQQ; if still below 90%, sell part of QQQ and buy TQQQ" },
      smallDipBuy: { title: "Small dip buy", condition: (thr) => `1 core low signal, or mild drawdown <= ${thr.mildDrawdown}%`, operation: "Buy QQQ with up to 2x monthly contribution" },
      crashDefense: { title: "Fast-crash defense", condition: (thr) => `25-day drop <= ${thr.fastCrash}% with no core low signal`, operation: "Sell about 1/2 of TQQQ; do not buy QQQ/TQQQ this month" },
      trimHeat: { title: "Trim heat", condition: "Bubble-watch CAPE lasts 6+ months", operation: "Sell about 1/12 of TQQQ; do not buy QQQ/TQQQ this month" },
      pauseAtHigh: { title: "Pause at high", condition: (thr) => `CAPE >= ${thr.highCape}% and within 5% of high, or ${thr.bubbleCape}% bubble watch`, operation: "Do not buy QQQ/TQQQ; hold monthly cash" },
      normalDca: { title: "Normal DCA", condition: "No higher-priority rule fires", operation: "Buy TQQQ until it reaches 20%; then buy QQQ, using 1/6 of spare cash monthly" },
    },
    guides: {
      qqqOnly: {
        badge: "Q",
        title: "Tactical QQQ",
        body: "Use the signals as a QQQ trading throttle: buy back QQQ in low and normal regimes, pause near highs, and sell some QQQ during fast-crash or heat regimes.",
        rule: "For accounts that want less chase risk without using leveraged ETFs.",
        actions: {
          bottomAttack: "Use monthly cash plus about 1/3 of saved cash to buy QQQ.",
          rampTqqq: "Keep deploying saved cash into QQQ over the 6 post-bottom months.",
          smallDipBuy: "Buy QQQ with up to 2x the monthly contribution.",
          crashDefense: "Sell about 1/4 of QQQ and keep this month's contribution in cash.",
          trimHeat: "Sell about 1/12 of QQQ and keep this month's contribution in cash.",
          pauseAtHigh: "Pause QQQ buying and keep this month's contribution in cash.",
          normalDca: "Buy QQQ; if cash was saved earlier, drip back up to 1/6 per month.",
        },
      },
      mixed: {
        badge: "Q/T",
        title: "Mixed QQQ/TQQQ book",
        body: "Use QQQ as the core and reserve TQQQ for low-regime attack. High and fast-crash regimes can trim TQQQ and raise cash.",
        rule: "For accounts willing to use limited leverage while still managing path risk.",
        actions: {
          bottomAttack: "Deploy cash into TQQQ in stages, then spend 6 months lifting TQQQ toward about 90%.",
          rampTqqq: "Keep buying TQQQ and rotate some QQQ into TQQQ if needed.",
          smallDipBuy: "Buy QQQ with up to 2x the monthly contribution.",
          crashDefense: "Sell about half of TQQQ and keep this month's contribution in cash.",
          trimHeat: "Sell about 1/12 of TQQQ while keeping a 20% TQQQ floor.",
          pauseAtHigh: "Pause QQQ/TQQQ buying and keep this month's contribution in cash.",
          normalDca: "Refill the 20% TQQQ floor first, then buy QQQ.",
        },
      },
      tqqqOnly: {
        badge: "T",
        title: "Tactical TQQQ",
        body: "Here the signals are mainly a risk switch: buy in low/normal regimes, pause near highs, and sell some TQQQ during fast-crash or heat regimes.",
        rule: "Only for high-risk accounts that can tolerate large drawdowns and long cash waits.",
        actions: {
          bottomAttack: "Use monthly cash plus about 1/3 of saved cash to buy TQQQ.",
          rampTqqq: "Keep deploying saved cash into TQQQ over the 6 post-bottom months.",
          smallDipBuy: "Buy TQQQ with the monthly contribution only; no 2x add.",
          crashDefense: "Sell about half of TQQQ and keep this month's contribution in cash.",
          trimHeat: "Sell about 1/12 of TQQQ and keep this month's contribution in cash.",
          pauseAtHigh: "Pause TQQQ buying and keep this month's contribution in cash.",
          normalDca: "Buy TQQQ; if cash was saved earlier, drip back up to 1/6 per month.",
        },
      },
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
      blend8020: "New-cash 80/20, no rebalance",
      signal: "Three-signal QQQ/TQQQ",
      signalQqq: "Tactical QQQ",
      signalTqqq: "Tactical TQQQ",
    },
    metricLabels: {
      finalValue: "Final value",
      multiple: "Multiple",
      irr: "IRR",
      maxDrawdown: "NAV max drawdown",
      regression: "Unit-NAV trend annualized",
      sharpe: "Excess-return Sharpe",
      ulcer: "Ulcer",
      bottomAttack: "Bottom attacks",
      shortSample: "Too short",
    },
    meta: (data) => `Generated ${fmtDateTime(data.generatedAt)}; rules ${data.rulesetId || "--"}; data ${data.dataSnapshotId || "--"}; Nasdaq ${fmtDate(data.indicators.nasdaq100.date)}; low signals ${data.decision.lowSignalCount}/3.${data.staleSources?.length ? ` Stale: ${localizedSources(data.staleSources).join(", ")}.` : ""}${data.fallbackSources?.length ? ` Fresh snapshot fallback: ${localizedSources(data.fallbackSources).join(", ")}.` : ""}`,
    capeNote: (cape) => `CAPE ${cape.value.toFixed(2)}; rolling sample ${cape.rollingMonths || 360} months; last cheap ${cape.lastCheap?.label || "none"}.`,
    ddNote: (ndx) => `5-day average ${fmtNumber(ndx.level5dAvg, 0)}; 25-day change ${fmtPct(ndx.crash25dPct)}.`,
    vixNote: (vix) => `Latest ${vix.latest.toFixed(2)}; date ${vix.date}.`,
  },
};

function initialLang() {
  try {
    const saved = localStorage.getItem("lang");
    if (saved === "zh" || saved === "en") return saved;
  } catch {}
  return (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
}

function setLang(nextLang) {
  lang = nextLang;
  try {
    localStorage.setItem("lang", nextLang);
  } catch {}
  updateShareUrl();
  renderStatic();
}

let lang = initialLang();
let marketData = null;
let backtestData = null;
let selected = new Set(["qqq", "tqqq", "signal", "signalQqq", "signalTqqq"]);
let showActionMarkers = false;
let errorMessage = "";
let backtestRequestId = 0;
let resizeFrame = 0;
let workbenchView = "positions";
let currentOrderPlan = null;
const ACCOUNT_STORAGE_KEY = "qqq-tqqq-account-v1";
const JOURNAL_STORAGE_KEY = "qqq-tqqq-journal-v1";

function fmtPct(n, digits = 1) {
  return `${Number(n).toFixed(digits)}%`;
}

function fmtMoney(n) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function fmtMoneyPrecise(n) {
  return `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtSignedMoney(n) {
  const sign = n < 0 ? "-" : n > 0 ? "+" : "";
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}

function fmtCompactMoney(n) {
  const value = Math.abs(n);
  if (value >= 1000000) return `$${(n / 1000000).toFixed(value >= 10000000 ? 1 : 2)}M`;
  if (value >= 1000) return `$${(n / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
  return fmtMoney(n);
}

function fmtSignedPct(n, digits = 1) {
  const sign = n > 0 ? "+" : "";
  return `${sign}${fmtPct(n, digits)}`;
}

function fmtNumber(n, digits = 1) {
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtDate(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}

function fmtDateTime(date) {
  return new Date(date).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });
}

function localizedSources(sources = []) {
  const zhLabels = { "Nasdaq-100": "纳指 100", QQQ: "QQQ", TQQQ: "TQQQ", VIX: "VIX", Rates: "利率", CAPE: "CAPE" };
  return sources.map((source) => (lang === "zh" ? zhLabels[source] || source : source));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
}

function readLocalJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeLocalJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function accountFromForm() {
  return {
    profile: $("riskProfileInput").value,
    cash: $("cashInput").value,
    qqqShares: $("qqqSharesInput").value,
    tqqqShares: $("tqqqSharesInput").value,
    monthlyContribution: $("monthlyContributionInput").value,
    costBps: $("executionCostInput").value,
    fractionalShares: $("fractionalSharesInput").checked,
  };
}

function restoreAccountForm() {
  const account = readLocalJson(ACCOUNT_STORAGE_KEY, null);
  if (!account || typeof account !== "object") return;
  if (["conservative", "standard", "aggressive"].includes(account.profile)) $("riskProfileInput").value = account.profile;
  for (const [id, key] of [["cashInput", "cash"], ["qqqSharesInput", "qqqShares"], ["tqqqSharesInput", "tqqqShares"], ["monthlyContributionInput", "monthlyContribution"]]) {
    if (Number.isFinite(Number(account[key])) && Number(account[key]) >= 0) $(id).value = String(account[key]);
  }
  if (["0", "5", "10"].includes(String(account.costBps))) $("executionCostInput").value = String(account.costBps);
  $("fractionalSharesInput").checked = account.fractionalShares !== false;
}

function marketSnapshotIsFresh() {
  const generatedAt = Date.parse(marketData?.generatedAt || "");
  return Number.isFinite(generatedAt) && Date.now() - generatedAt <= 30 * 60 * 1000;
}

function orderPlanIsFresh() {
  const generatedAt = Date.parse(currentOrderPlan?.generatedAt || "");
  return Number.isFinite(generatedAt) && Date.now() - generatedAt <= 30 * 60 * 1000;
}

function renderRiskProfileNote() {
  const profile = $("riskProfileInput").value;
  $("riskProfileNote").textContent = copy[lang].execution.profiles[profile]?.[1] || "";
}

function showAccountError(message = "") {
  $("accountError").hidden = !message;
  $("accountError").textContent = message;
}

function localizedPlannerError(error) {
  if (lang !== "zh") return error.message;
  const labels = {
    Cash: "现金",
    "QQQ shares": "QQQ 份额",
    "TQQQ shares": "TQQQ 份额",
    "Monthly contribution": "本月投入",
    "Trading cost": "交易摩擦",
    "QQQ price": "QQQ 报价",
    "TQQQ price": "TQQQ 报价",
  };
  for (const [english, chinese] of Object.entries(labels)) {
    if (error.message.startsWith(`${english} must be between`)) return `${chinese}超出允许范围。`;
  }
  if (error.message.includes("risk policy")) return "风险档参数不可用，请刷新数据。";
  if (error.message.includes("quotes are unavailable")) return "ETF 收盘报价不可用，请刷新数据。";
  if (error.message.includes("TQQQ targets")) return "TQQQ 目标不能超过风险档上限。";
  if (error.message.includes("Trading cost must")) return "交易摩擦只能选择 0、5 或 10 bp。";
  return "订单输入无效，请检查持仓、风险档和报价。";
}

function renderOrderDraft() {
  const t = copy[lang].execution;
  const status = $("orderStatus");
  status.className = "order-status";
  if (currentOrderPlan && !orderPlanIsFresh()) currentOrderPlan = null;
  if (!currentOrderPlan) {
    const blocked = marketData && (marketData.decision?.available === false || marketData.executionReady === false || !marketSnapshotIsFresh());
    $("orderTitle").textContent = blocked ? t.blocked : t.emptyTitle;
    status.textContent = blocked ? t.blocked : t.waiting;
    if (blocked) status.classList.add("blocked");
    $("orderMeta").textContent = marketData
      ? `${t.quote}: ${marketData.quotes?.qqq?.date || "--"} · ${t.ruleset}: ${marketData.rulesetId || "--"}`
      : "";
    $("orderSummary").innerHTML = blocked
      ? `<p class="small-note">${escapeHtml(lang === "zh" ? "关键行情或信号数据未就绪，订单功能已关闭。" : "Critical quote or signal data is not ready, so order drafting is disabled.")}</p>`
      : "";
    $("recordPlanBtn").disabled = true;
    return;
  }
  status.textContent = t.ready;
  status.classList.add("ready");
  $("orderTitle").textContent = actionTitle(currentOrderPlan.decisionKey);
  $("orderMeta").textContent = `${t.quote}: ${currentOrderPlan.quoteDate || "--"} · ${t.ruleset}: ${currentOrderPlan.rulesetId} · ${currentOrderPlan.costBps} bp`;
  const rows = currentOrderPlan.orders.map((order) => {
    const side = order.side === "BUY" ? t.buy : t.sell;
    const sideClass = order.side === "BUY" ? "buy" : "sell";
    return `<div class="order-row">
      <span class="order-side ${sideClass}">${side}</span>
      <div class="order-main"><strong>${order.symbol}</strong><span>${fmtNumber(order.shares, order.shares % 1 ? 3 : 0)} ${lang === "zh" ? "份" : "shares"} @ ${fmtMoneyPrecise(order.price)}</span></div>
      <div class="order-amount"><strong>${fmtMoney(order.notional)}</strong><span>${t.estimatedCost} ${fmtMoneyPrecise(order.estimatedCost)}</span></div>
    </div>`;
  }).join("");
  const noTrade = currentOrderPlan.orders.length ? "" : `<p class="small-note">${t.noTrade}</p>`;
  $("orderSummary").innerHTML = `${rows}${noTrade}
    <div class="order-total-row"><span>${t.retainedCash}</span><strong>${fmtMoney(currentOrderPlan.retainedCash)}</strong></div>
    <div class="order-total-row"><span>${t.floorGap}</span><strong>${fmtMoney(currentOrderPlan.distanceToTqqqFloor)}</strong></div>`;
  $("recordPlanBtn").disabled = false;
}

function planCurrentOrders(event) {
  event.preventDefault();
  showAccountError();
  try {
    if (!marketData?.decision?.available || !marketData.executionReady) throw new Error(copy[lang].execution.blocked);
    if (!marketSnapshotIsFresh()) throw new Error(copy[lang].execution.marketExpired);
    const account = accountFromForm();
    const policy = marketData.riskPolicies?.[account.profile];
    const plan = ExecutionPlanner.planOrders({
      account,
      policy,
      decision: marketData.decision,
      quotes: marketData.quotes,
      costBps: Number(account.costBps),
    });
    currentOrderPlan = {
      ...plan,
      decisionKey: marketData.decision.key,
      profile: account.profile,
      rulesetId: marketData.rulesetId,
      dataSnapshotId: marketData.dataSnapshotId,
      generatedAt: new Date().toISOString(),
    };
    if (!writeLocalJson(ACCOUNT_STORAGE_KEY, account)) showAccountError(copy[lang].execution.savedError);
    renderOrderDraft();
  } catch (error) {
    currentOrderPlan = null;
    showAccountError(localizedPlannerError(error));
    renderOrderDraft();
  }
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportMonthlyCalendar() {
  const text = ExecutionPlanner.calendarIcs({ lang });
  downloadText("qqq-tqqq-monthly-review.ics", text, "text/calendar;charset=utf-8");
}

function readJournal() {
  const entries = readLocalJson(JOURNAL_STORAGE_KEY, []);
  return Array.isArray(entries) ? entries.filter((entry) => entry && typeof entry === "object") : [];
}

function recordCurrentPlan() {
  if (!currentOrderPlan || !orderPlanIsFresh() || !marketSnapshotIsFresh()) {
    currentOrderPlan = null;
    showAccountError(copy[lang].execution.marketExpired);
    renderOrderDraft();
    return;
  }
  const entry = {
    id: `${Date.now()}`,
    recordedAt: new Date().toISOString(),
    decisionKey: currentOrderPlan.decisionKey,
    profile: currentOrderPlan.profile,
    rulesetId: currentOrderPlan.rulesetId,
    dataSnapshotId: currentOrderPlan.dataSnapshotId,
    quoteDate: currentOrderPlan.quoteDate,
    orders: currentOrderPlan.orders,
    retainedCash: currentOrderPlan.retainedCash,
    actualNote: $("actualNoteInput").value.trim(),
  };
  const entries = [entry, ...readJournal()].slice(0, 24);
  if (!writeLocalJson(JOURNAL_STORAGE_KEY, entries)) {
    showAccountError(copy[lang].execution.savedError);
    return;
  }
  $("recordPlanBtn").textContent = copy[lang].execution.recorded;
  setTimeout(() => { if ($("recordPlanBtn")) $("recordPlanBtn").textContent = copy[lang].execution.record; }, 1200);
  renderJournal();
}

function renderJournal() {
  const t = copy[lang].execution;
  const entries = readJournal().slice(0, 6);
  if (!entries.length) {
    $("journalEntries").innerHTML = `<p class="small-note">${t.journalEmpty}</p>`;
    return;
  }
  $("journalEntries").innerHTML = entries.map((entry) => {
    const safeOrders = Array.isArray(entry.orders) ? entry.orders.filter((order) => (
      order && ["BUY", "SELL"].includes(order.side) && ["QQQ", "TQQQ"].includes(order.symbol) && Number.isFinite(Number(order.shares))
    )) : [];
    const orders = safeOrders.map((order) => `${order.side === "BUY" ? t.buy : t.sell} ${fmtNumber(Number(order.shares), Number(order.shares) % 1 ? 3 : 0)} ${order.symbol}`).join(" · ") || t.noTrade;
    const profile = t.profiles[entry.profile]?.[0] || entry.profile;
    return `<article class="journal-entry">
      <strong>${escapeHtml(fmtDateTime(entry.recordedAt))} · ${escapeHtml(actionTitle(entry.decisionKey))}</strong>
      <span>${escapeHtml(profile)} · ${escapeHtml(orders)}</span>
      <small>${escapeHtml(entry.actualNote || "-")}</small>
    </article>`;
  }).join("");
}

function clearAccountData() {
  const message = lang === "zh" ? "清除当前浏览器保存的持仓输入？执行记录不会被删除。" : "Clear saved holdings from this browser? Journal records will remain.";
  if (!window.confirm(message)) return;
  try { localStorage.removeItem(ACCOUNT_STORAGE_KEY); } catch {}
  $("riskProfileInput").value = "standard";
  $("cashInput").value = "0";
  $("qqqSharesInput").value = "0";
  $("tqqqSharesInput").value = "0";
  $("monthlyContributionInput").value = "1000";
  $("executionCostInput").value = "5";
  $("fractionalSharesInput").checked = true;
  $("actualNoteInput").value = "";
  currentOrderPlan = null;
  showAccountError();
  renderRiskProfileNote();
  renderOrderDraft();
}

function clearJournal() {
  const message = lang === "zh" ? "永久清空当前浏览器中的执行记录？" : "Permanently clear execution records from this browser?";
  if (!window.confirm(message)) return;
  try { localStorage.removeItem(JOURNAL_STORAGE_KEY); } catch {}
  renderJournal();
}

function hasRegression(strategy) {
  return Number.isFinite(strategy.regression?.annualized);
}

function visibleStrategies() {
  if (!backtestData) return [];
  return visibleStrategyKeys
    .map((key) => backtestData.strategies.find((strategy) => strategy.key === key))
    .filter(Boolean);
}

function renderError() {
  const error = $("error");
  error.hidden = !errorMessage;
  error.textContent = errorMessage ? `${copy[lang].error}${errorMessage}` : "";
  if (errorMessage && !marketData) {
    $("action").textContent = copy[lang].errorTitle;
    $("operation").textContent = errorMessage;
    $("risk").textContent = "";
  }
}

function showError(message) {
  errorMessage = message;
  renderError();
}

function clearError() {
  errorMessage = "";
  renderError();
}

function isCheckedParam(params, key, fallback) {
  const value = params.get(key);
  if (value == null) return fallback;
  return value === "1" || value === "true";
}

function optionExists(select, value) {
  return [...select.options].some((option) => option.value === value);
}

function applyUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const urlLang = params.get("lang");
  if (urlLang === "zh" || urlLang === "en") lang = urlLang;
  const start = params.get("start");
  if (start && optionExists($("startInput"), start)) $("startInput").value = start;
  const cost = params.get("cost");
  if (cost && optionExists($("costInput"), cost)) $("costInput").value = cost;
  const strategyParam = params.get("strategies");
  if (strategyParam) {
    const next = strategyParam.split(",").filter((key) => visibleStrategySet.has(key));
    if (next.length) selected = new Set(next);
  }
  $("trendInput").checked = isCheckedParam(params, "trend", $("trendInput").checked);
  $("scaleInput").checked = isCheckedParam(params, "log", $("scaleInput").checked);
  $("qqqAxisInput").checked = isCheckedParam(params, "qqqAxis", $("qqqAxisInput").checked);
  showActionMarkers = isCheckedParam(params, "actions", showActionMarkers);
  const view = params.get("view");
  if (workbenchViews.includes(view)) workbenchView = view;
}

function updateShareUrl() {
  const params = new URLSearchParams();
  params.set("start", $("startInput").value);
  params.set("cost", $("costInput").value);
  params.set("lang", lang);
  params.set("strategies", [...selected].filter((key) => visibleStrategySet.has(key)).join(","));
  params.set("trend", $("trendInput").checked ? "1" : "0");
  if ($("scaleInput").checked) params.set("log", "1");
  if ($("qqqAxisInput").checked) params.set("qqqAxis", "1");
  if (showActionMarkers) params.set("actions", "1");
  if (workbenchView !== "positions") params.set("view", workbenchView);
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

function setChartState(message = "") {
  const el = $("chartState");
  el.hidden = !message;
  el.textContent = message;
}

function setBacktestLoading(on) {
  $("startInput").disabled = on;
  $("costInput").disabled = on;
  if (on) setChartState(copy[lang].loadingBacktest);
}

function setStatus(dotId, labelId, cls, label) {
  $(dotId).className = `dot ${cls}`;
  $(labelId).textContent = label;
}

function renderSparkline(id, points, formatValue) {
  const el = $(id);
  if (!Array.isArray(points) || points.length === 0) {
    el.textContent = "--";
    return;
  }
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 180;
  const height = 42;
  const coords = points.map((point, index) => {
    const x = points.length === 1 ? width : (index / (points.length - 1)) * width;
    const y = height - ((point.value - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const first = points[0];
  const last = points.at(-1);
  const firstLabel = first.label || first.date;
  const lastLabel = last.label || last.date;
  el.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${coords}"></polyline>
    </svg>
    <div class="spark-meta">
      <span>${escapeHtml(firstLabel)}: ${formatValue(first.value)}</span>
      <span>${escapeHtml(lastLabel)}: ${formatValue(last.value)}</span>
    </div>
  `;
}

function currentRuleThresholds() {
  return { ...DEFAULT_RULE_THRESHOLDS, ...(marketData?.decision?.thresholds || {}) };
}

function renderStatic() {
  const t = copy[lang];
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  $("eyebrow").textContent = t.eyebrow;
  $("title").textContent = t.title;
  $("subtitle").textContent = t.subtitle;
  $("refreshDataBtn").textContent = t.refreshData;
  $("decisionKicker").textContent = t.decisionKicker;
  $("confidenceLabel").textContent = t.confidenceLabel;
  $("lockedLabel").textContent = t.lockedLabel;
  $("liveLabel").textContent = t.liveLabel;
  $("upgradeLabel").textContent = t.upgradeLabel;
  $("edgeKicker").textContent = t.edgeKicker;
  $("disclaimer").textContent = t.disclaimer;
  const execution = t.execution;
  $("executionKicker").textContent = execution.kicker;
  $("executionTitle").textContent = execution.title;
  $("executionNote").textContent = execution.note;
  $("localOnlyBadge").textContent = execution.localOnly;
  $("riskProfileLabel").textContent = execution.riskProfile;
  $("cashInputLabel").textContent = execution.cash;
  $("qqqSharesLabel").textContent = execution.qqqShares;
  $("tqqqSharesLabel").textContent = execution.tqqqShares;
  $("monthlyInputLabel").textContent = execution.monthly;
  $("executionCostLabel").textContent = execution.cost;
  $("fractionalSharesLabel").textContent = execution.fractional;
  $("riskConservativeOption").textContent = execution.profiles.conservative[0];
  $("riskStandardOption").textContent = execution.profiles.standard[0];
  $("riskAggressiveOption").textContent = execution.profiles.aggressive[0];
  $("planOrdersBtn").textContent = execution.plan;
  $("clearAccountBtn").textContent = execution.clear;
  $("orderKicker").textContent = execution.nextSession;
  $("calendarBtn").textContent = execution.calendar;
  $("recordPlanBtn").textContent = execution.record;
  $("actualNoteLabel").textContent = execution.actualNote;
  $("actualNoteInput").placeholder = execution.actualPlaceholder;
  $("journalKicker").textContent = execution.journalKicker;
  $("journalTitle").textContent = execution.journalTitle;
  $("clearJournalBtn").textContent = execution.clearJournal;
  $("historyKicker").textContent = t.historyKicker;
  $("historyTitle").textContent = t.historyTitle;
  $("historyNote").textContent = t.historyNote;
  $("capeLabel").textContent = t.capeLabel;
  $("ddLabel").textContent = t.ddLabel;
  $("vixLabel").textContent = t.vixLabel;
  $("capeHistoryLabel").textContent = t.historyLabels.cape;
  $("ddHistoryLabel").textContent = t.historyLabels.nasdaq100;
  $("vixHistoryLabel").textContent = t.historyLabels.vix;
  $("methodKicker").textContent = t.methodKicker;
  $("methodTitle").textContent = t.methodTitle;
  $("actionCatalogKicker").textContent = t.actionCatalogKicker;
  $("actionCatalogTitle").textContent = t.actionCatalogTitle;
  $("actionCatalogNote").textContent = t.actionCatalogNote;
  $("guideKicker").textContent = t.guideKicker;
  $("guideTitle").textContent = t.guideTitle;
  $("guideNote").textContent = t.guideNote;
  $("backtestKicker").textContent = t.backtestKicker;
  $("backtestTitle").textContent = t.backtestTitle;
  $("startLabel").textContent = t.startLabel;
  $("monthlyFixedLabel").textContent = t.monthlyFixedLabel;
  $("costLabel").textContent = t.costLabel;
  $("trendLabel").textContent = t.trendLabel;
  $("scaleLabel").textContent = t.scaleLabel;
  $("qqqAxisLabel").textContent = t.qqqAxisLabel;
  $("actionMarkersLabel").textContent = t.actionMarkersLabel;
  $("actionsInput").checked = showActionMarkers;
  $("backtestNote").textContent = t.backtestNote;
  $("zhBtn").classList.toggle("active", lang === "zh");
  $("enBtn").classList.toggle("active", lang === "en");
  $("zhBtn").setAttribute("aria-pressed", String(lang === "zh"));
  $("enBtn").setAttribute("aria-pressed", String(lang === "en"));
  renderError();

  const thresholds = currentRuleThresholds();
  $("methods").replaceChildren(...t.methods.map((item) => {
    const card = document.createElement("article");
    card.className = "method-card";
    const body = typeof item.body === "function" ? item.body(thresholds) : item.body;
    card.innerHTML = `<h3>${item.title}</h3><p>${body}</p>`;
    return card;
  }));

  renderActionCatalog();
  renderExecutionGuides();
  if (!marketData && !errorMessage) {
    $("action").textContent = t.loadingAction;
    $("operation").textContent = t.loadingOperation;
  }
  renderMarket();
  renderRiskProfileNote();
  renderOrderDraft();
  renderJournal();
  renderStrategyToggles();
  renderBacktest();
}

function renderActionCatalog() {
  const t = copy[lang];
  const thresholds = currentRuleThresholds();
  $("actionCatalog").replaceChildren(...actionOrder.map((key) => {
    const action = t.actions[key];
    const visual = actionVisuals[key];
    const card = document.createElement("article");
    card.className = "action-card";
    card.innerHTML = `
      <span class="action-icon" style="background:${visual.color}">${visual.icon}</span>
      <div>
        <h3>${action.title}</h3>
        <p class="condition">${typeof action.condition === "function" ? action.condition(thresholds) : action.condition}</p>
        <p>${action.operation}</p>
      </div>
    `;
    return card;
  }));
}

function renderExecutionGuides() {
  const t = copy[lang];
  const currentKey = marketData?.decision?.key || marketData?.liveDecision?.key || "normalDca";
  $("executionGuides").replaceChildren(...Object.entries(guideStrategyKeys).map(([key, strategyKey]) => {
    const guide = t.guides[key];
    const card = document.createElement("article");
    const strategy = backtestData?.strategies.find((item) => item.key === strategyKey);
    const stats = strategy ? `
      <div class="guide-stats">
        <div><span>${t.guideStatsFinal}</span><strong>${fmtMoney(strategy.finalValue)}</strong></div>
        <div><span>${t.guideStatsDrawdown}</span><strong>${fmtPct(strategy.maxDrawdown * 100)}</strong></div>
      </div>
    ` : "";
    card.className = "guide-card";
    card.innerHTML = `
      <div class="guide-card-head">
        <span class="guide-badge">${guide.badge}</span>
        <div>
          <h3>${guide.title}</h3>
          <p>${guide.rule}</p>
        </div>
      </div>
      <p>${guide.body}</p>
      <p>${t.guideReferenceNote}</p>
      <div class="guide-now">
        <span>${t.decisionKicker}</span>
        <strong>${guide.actions[currentKey]}</strong>
      </div>
      ${stats}
    `;
    return card;
  }));
}

function chip(label, on) {
  const el = document.createElement("span");
  el.className = `chip${on ? " on" : ""}`;
  el.textContent = `${on ? "✓ " : ""}${label}`;
  el.setAttribute("aria-label", `${label}: ${on ? "on" : "off"}`);
  return el;
}

function actionTitle(key) {
  return copy[lang].actions[key]?.title || copy[lang].decisions[key]?.[0] || key;
}

function renderEdgeCard() {
  const t = copy[lang];
  const card = $("edgeCard");
  const headline = backtestData?.headline;
  if (!headline?.signalVsQqq) {
    card.hidden = false;
    $("edgeMultiple").textContent = "--";
    $("edgeNote").textContent = t.edgeEmpty;
    $("edgeStats").replaceChildren();
    return;
  }
  card.hidden = false;
  const rel = headline.signalVsQqq.finalRelativeMultiple;
  $("edgeMultiple").textContent = `${fmtNumber(rel, 2)}x`;
  $("edgeNote").textContent = t.edgeNote(headline);
  const allocationMatchedRel = headline.allocationMatched?.signalVsStatic?.finalRelativeMultiple;
  $("edgeStats").innerHTML = `
    <div><span>${t.edgeStats.multiple}</span><strong>${fmtNumber(rel, 2)}x</strong></div>
    <div><span>${t.edgeStats.allocationMatched}</span><strong>${allocationMatchedRel == null ? "--" : `${fmtNumber(allocationMatchedRel, 2)}x`}</strong></div>
    <div><span>${t.edgeStats.relativeDrawdown}</span><strong>${fmtPct((headline.signalVsQqq.maxRelativeDrawdown || 0) * 100)}</strong></div>
    <div><span>${t.edgeStats.underwater}</span><strong>${headline.signalVsQqq.longestRelativeUnderwaterMonths || 0} ${lang === "zh" ? "个月" : "mo"}</strong></div>
  `;
}

function renderDecisionHistory() {
  const el = $("decisionHistory");
  const t = copy[lang];
  const rows = marketData?.decisionHistory || [];
  if (!rows.length) {
    el.innerHTML = `<p class="small-note">${t.historyEmpty}</p>`;
    return;
  }
  el.replaceChildren(...rows.map((row) => {
    const item = document.createElement("div");
    const visual = actionVisuals[row.key] || actionVisuals.normalDca;
    item.className = `history-chip${row.upgraded ? " upgraded" : ""}`;
    item.style.setProperty("--action-color", visual.color);
    item.innerHTML = `
      <span class="history-month">${escapeHtml(row.month)}</span>
      <span class="history-action" style="background:${visual.color}">${escapeHtml(visual.icon)}</span>
      <strong>${escapeHtml(actionTitle(row.key))}</strong>
      ${row.upgraded ? `<em>${escapeHtml(t.upgradedMark)}</em>` : ""}
    `;
    item.title = `${row.month}: ${actionTitle(row.key)}${row.upgraded ? ` (${actionTitle(row.lockedKey)} → ${actionTitle(row.key)})` : ""}`;
    return item;
  }));
}

function renderMarket() {
  if (!marketData) return;
  const t = copy[lang];
  const { cape, nasdaq100, vix } = marketData.indicators;
  const thr = currentRuleThresholds();
  const cheapCape = thr.cheapCape;
  const deepDd = thr.deepDrawdown;
  const mildDd = thr.mildDrawdown;
  const panicVix = thr.panicVix;
  const fastCrash = thr.fastCrash;

  $("capeValue").textContent = fmtPct(cape.percentile);
  $("capeNote").textContent = t.capeNote(cape);
  const capeState = cape.percentile < cheapCape
    ? ["blue", t.statusLabels.cheap]
    : cape.percentile >= thr.highCape
      ? ["red", t.statusLabels.expensive]
      : ["amber", t.statusLabels.neutral];
  setStatus("capeDot", "capeStatus", capeState[0], capeState[1]);
  renderSparkline("capeSparkline", cape.recent, (value) => value.toFixed(2));

  $("ddValue").textContent = fmtPct(nasdaq100.drawdownPct);
  $("ddNote").textContent = t.ddNote(nasdaq100);
  const ddState = nasdaq100.drawdownPct <= deepDd
    ? ["blue", t.statusLabels.deep]
    : nasdaq100.crash25dPct <= fastCrash
      ? ["red", t.statusLabels.fastCrash]
      : nasdaq100.drawdownPct <= mildDd
        ? ["blue", t.statusLabels.mild]
        : ["amber", t.statusLabels.normal];
  setStatus("ddDot", "ddStatus", ddState[0], ddState[1]);
  renderSparkline("ddSparkline", nasdaq100.recent, (value) => fmtNumber(value, 0));

  $("vixValue").textContent = fmtNumber(vix.value5dAvg, 1);
  $("vixNote").textContent = t.vixNote(vix);
  const vixState = vix.value5dAvg >= panicVix
    ? ["blue", t.statusLabels.panic]
    : vix.value5dAvg <= thr.quietVix
      ? ["red", t.statusLabels.lowVol]
      : ["amber", t.statusLabels.normal];
  setStatus("vixDot", "vixStatus", vixState[0], vixState[1]);
  renderSparkline("vixSparkline", vix.recent, (value) => fmtNumber(value, 1));

  const decision = marketData.decision;
  const text = t.decisions[decision.key] || t.decisions.normalDca;
  $("decisionPanel").style.setProperty("--decision-color", actionVisuals[decision.key]?.color || colors.signal);
  if (decision.available === false) {
    $("action").textContent = t.execution.blocked;
    $("operation").textContent = lang === "zh"
      ? `关键数据已过期：${localizedSources(decision.blockedSources).join("、")}。本月动作仅供历史参考。`
      : `Critical inputs are stale: ${localizedSources(decision.blockedSources).join(", ")}. The action is historical context only.`;
    $("risk").textContent = lang === "zh" ? "数据恢复前不生成订单草稿。" : "No order draft is produced until the data recovers.";
  } else {
    $("action").textContent = text[0];
    $("operation").textContent = text[1];
    $("risk").textContent = text[2];
  }

  const confidence = decision.confidence || { level: "medium" };
  $("confidencePill").hidden = false;
  $("confidencePill").dataset.level = confidence.level;
  $("confidenceValue").textContent = t.confidenceLevels[confidence.level] || confidence.level;

  $("cadenceRow").hidden = false;
  $("lockedValue").textContent = actionTitle(decision.lockedKey || decision.key);
  $("liveValue").textContent = actionTitle(decision.liveKey || decision.key);
  $("upgradeValue").textContent = decision.upgraded ? t.upgradeYes : t.upgradeNo;

  $("meta").textContent = t.meta(marketData);
  $("sources").innerHTML = `${t.sources}<a href="https://finance.yahoo.com/quote/%5ENDX/">Yahoo ^NDX</a>, <a href="https://finance.yahoo.com/quote/QQQ/">Yahoo QQQ</a>, <a href="https://finance.yahoo.com/quote/TQQQ/">Yahoo TQQQ</a>, <a href="https://finance.yahoo.com/quote/%5EVIX/">Yahoo ^VIX</a>, <a href="https://fred.stlouisfed.org/series/FEDFUNDS">FRED FEDFUNDS</a>, <a href="https://www.multpl.com/shiller-pe/table/by-month">Multpl Shiller PE</a>.`;

  $("chips").replaceChildren(
    chip(t.chips.valuationCheap, decision.lowSignals.valuationCheap),
    chip(t.chips.deepDrawdown, decision.lowSignals.deepDrawdown),
    chip(t.chips.panicVix, decision.lowSignals.panicVix),
    chip(t.chips.valuationHigh, decision.defensiveFlags.valuationHigh),
    chip(t.chips.nearHigh, decision.defensiveFlags.nearHigh),
    chip(t.chips.fastCrash, decision.defensiveFlags.fastCrash),
    chip(t.chips.quietVix, decision.defensiveFlags.quietVix),
  );
  renderDecisionHistory();
  renderEdgeCard();
  renderExecutionGuides();
  renderOrderDraft();
}

function renderStrategyToggles() {
  const t = copy[lang];
  $("strategyToggles").replaceChildren(...visibleStrategyKeys.map((key) => {
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
      updateShareUrl();
      renderBacktest();
    });
  });
}

function renderBacktest() {
  if (!backtestData) return;
  renderChart();
  renderExecutionGuides();
  renderWorkbench();
  renderEdgeCard();
  const t = copy[lang];
  const cards = visibleStrategies().map((strategy) => {
    const card = document.createElement("article");
    card.className = `metric-card${selected.has(strategy.key) ? "" : " muted-card"}`;
    const bottomRow = strategy.key.startsWith("signal")
      ? `<div class="metric-row"><span>${t.metricLabels.bottomAttack}</span><strong>${strategy.actionCounts?.bottomAttack || 0}</strong></div>`
      : "";
    const vsRow = strategy.vsQqq
      ? `<div class="metric-row"><span>vs QQQ</span><strong>${fmtNumber(strategy.vsQqq.finalRelativeMultiple, 2)}x</strong></div>`
      : "";
    card.innerHTML = `
      <h3><span class="swatch" style="display:inline-block;background:${colors[strategy.key]}"></span> ${t.strategies[strategy.key]}</h3>
      <div class="metric-row"><span>${t.metricLabels.finalValue}</span><strong>${fmtMoney(strategy.finalValue)}</strong></div>
      <div class="metric-row"><span>${t.metricLabels.multiple}</span><strong>${fmtNumber(strategy.multiple, 2)}x</strong></div>
      <div class="metric-row"><span>${t.metricLabels.irr}</span><strong>${strategy.irr == null ? "--" : fmtPct(strategy.irr * 100)}</strong></div>
      <div class="metric-row"><span>${t.metricLabels.maxDrawdown}</span><strong>${fmtPct(strategy.maxDrawdown * 100)}</strong></div>
      <div class="metric-row"><span>${t.metricLabels.regression}</span><strong>${hasRegression(strategy) ? fmtPct(strategy.regression.annualized * 100) : t.metricLabels.shortSample}</strong></div>
      <div class="metric-row"><span>${t.metricLabels.sharpe}</span><strong>${strategy.risk?.sharpe == null ? "--" : fmtNumber(strategy.risk.sharpe, 2)}</strong></div>
      <div class="metric-row"><span>${t.metricLabels.ulcer}</span><strong>${strategy.risk?.ulcer == null ? "--" : fmtNumber(strategy.risk.ulcer, 1)}</strong></div>
      ${vsRow}
      ${bottomRow}
    `;
    return card;
  });
  $("metrics").replaceChildren(...cards);
  renderSensitivity();
}

function currentSignalStrategy() {
  return backtestData?.strategies.find((strategy) => strategy.key === "signal");
}

function percentWidth(value) {
  return `${Math.max(0, Math.min(100, value * 100)).toFixed(1)}%`;
}

function renderWorkbench() {
  const el = $("workbench");
  if (!backtestData) {
    el.replaceChildren();
    return;
  }
  const t = copy[lang];
  const active = workbenchViews.includes(workbenchView) ? workbenchView : "positions";
  const tabs = workbenchViews.map((key) => `<button id="workbench-tab-${key}" type="button" role="tab" aria-controls="workbench-panel" aria-selected="${active === key}" tabindex="${active === key ? 0 : -1}" class="workbench-tab${active === key ? " active" : ""}" data-view="${key}">${t.tabs[key]}</button>`).join("");
  const panels = {
    positions: renderPositionsView(),
    events: renderEventsView(),
    attribution: renderAttributionView(),
    validation: renderValidationView(),
    data: renderDataView(),
  };
  el.innerHTML = `
    <div class="workbench-head">
      <div>
        <p class="eyebrow">${t.workbenchTitle}</p>
        <div class="workbench-tabs" role="tablist" aria-label="${t.workbenchTitle}">${tabs}</div>
      </div>
      <div class="workbench-actions">
        <button id="copyLinkBtn" type="button" class="ghost">${t.copyLink}</button>
        <button id="exportCsvBtn" type="button">${t.exportCsv}</button>
      </div>
    </div>
    <div id="workbench-panel" class="workbench-body" role="tabpanel" aria-labelledby="workbench-tab-${active}">${panels[active]}</div>
  `;
  const activate = (view, focus = false) => {
    workbenchView = view;
    updateShareUrl();
    renderWorkbench();
    if (focus) $("workbench").querySelector(`[data-view="${view}"]`)?.focus();
  };
  el.querySelectorAll(".workbench-tab").forEach((button) => {
    button.addEventListener("click", () => activate(button.dataset.view, true));
    button.addEventListener("keydown", (event) => {
      const index = workbenchViews.indexOf(button.dataset.view);
      const next = event.key === "ArrowRight" ? (index + 1) % workbenchViews.length
        : event.key === "ArrowLeft" ? (index - 1 + workbenchViews.length) % workbenchViews.length
          : event.key === "Home" ? 0 : event.key === "End" ? workbenchViews.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault();
      activate(workbenchViews[next], true);
    });
  });
  $("exportCsvBtn").addEventListener("click", exportCsv);
  $("copyLinkBtn").addEventListener("click", copyShareLink);
  if (active === "positions") drawWeightChart();
}

function renderPositionsView() {
  const t = copy[lang];
  const signal = currentSignalStrategy();
  const latest = signal?.points.at(-1);
  if (!latest) return "";
  const actionKey = latest.actionKey || "normalDca";
  const action = t.actions[actionKey];
  const weights = [
    { key: "cash", label: t.workbench.cash, value: latest.cashWeight, color: "#475467" },
    { key: "qqq", label: t.workbench.qqq, value: latest.qqqWeight, color: colors.qqq },
    { key: "tqqq", label: t.workbench.tqqq, value: latest.tqqqWeight, color: colors.tqqq },
  ];
  const weightCards = weights.map((item) => `
    <div class="weight-card">
      <span>${item.label}</span>
      <strong>${fmtPct(item.value * 100)}</strong>
      <div class="weight-track"><i style="width:${percentWidth(item.value)};background:${item.color}"></i></div>
    </div>
  `).join("");
  const synthetic = signal.points.some((point) => point.tqqqSource === "synthetic")
    ? `<span class="data-badge">${t.workbench.syntheticTqqq}</span>`
    : "";
  return `
    <div class="positions-grid">
      <div>
        <h3>${t.workbench.latestWeights}</h3>
        <div class="weights-grid">${weightCards}</div>
        <div class="latest-action">
          <span class="action-icon" style="background:${actionVisuals[actionKey].color}">${actionVisuals[actionKey].icon}</span>
          <div><strong>${t.workbench.latestAction}: ${action.title}</strong><p>${action.operation}</p></div>
        </div>
        ${synthetic}
      </div>
      <div class="weight-chart-panel">
        <div class="chart-panel-head">
          <h3>${t.workbench.weightsChart}</h3>
          <div class="mini-legend">
            <span><i style="background:#475467"></i>${t.workbench.cash}</span>
            <span><i style="background:${colors.qqq}"></i>${t.workbench.qqq}</span>
            <span><i style="background:${colors.tqqq}"></i>${t.workbench.tqqq}</span>
          </div>
        </div>
        <canvas id="weightChart" height="220"></canvas>
      </div>
    </div>
  `;
}

function drawWeightChart() {
  const canvas = $("weightChart");
  const signal = currentSignalStrategy();
  if (!canvas || !signal?.points.length) return;
  const wrap = canvas.parentElement;
  const rect = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(220, Math.floor(220 * dpr));
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const pad = { left: 42, right: 14, top: 14, bottom: 28 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const points = signal.points;
  const xFor = (i) => pad.left + (points.length <= 1 ? 0 : i / (points.length - 1)) * plotW;
  const yFor = (value) => pad.top + (1 - Math.max(0, Math.min(1, value))) * plotH;
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#d4dbe5";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#667085";
  ctx.font = "11px ui-sans-serif, system-ui";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  [0, 0.5, 1].forEach((value) => {
    const y = yFor(value);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(fmtPct(value * 100, 0), pad.left - 8, y);
  });
  [
    ["cashWeight", "#475467"],
    ["qqqWeight", colors.qqq],
    ["tqqqWeight", colors.tqqq],
  ].forEach(([key, color]) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((point, i) => {
      const x = xFor(i);
      const y = yFor(point[key]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
  ctx.fillStyle = "#667085";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  [0, Math.floor((points.length - 1) / 2), points.length - 1].forEach((i) => {
    ctx.fillText(points[i].date.slice(0, 4), xFor(i), height - pad.bottom + 10);
  });
}

function renderEventsView() {
  const t = copy[lang];
  const events = backtestData.events || [];
  if (!events.length) return `<p class="muted">${t.workbench.eventsEmpty}</p>`;
  return `
    <h3>${t.workbench.eventsTitle}</h3>
    <div class="event-grid">
      ${events.map((event) => {
        const signal = event.strategies.find((strategy) => strategy.key === "signal");
        const qqq = event.strategies.find((strategy) => strategy.key === "qqq");
        const topActions = Object.entries(signal?.actionCounts || {})
          .filter(([, count]) => count > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3);
        return `
          <article class="event-card">
            <div class="event-head"><strong>${t.events[event.key] || event.key}</strong><span>${event.start.slice(0, 7)} - ${event.end.slice(0, 7)}</span></div>
            <div class="event-stats">
              <div><span>${t.workbench.signalReturn}</span><strong>${signal ? fmtSignedPct(signal.returnPct * 100) : "--"}</strong></div>
              <div><span>${t.workbench.qqqReturn}</span><strong>${qqq ? fmtSignedPct(qqq.returnPct * 100) : "--"}</strong></div>
              <div><span>${t.workbench.drawdown}</span><strong>${signal ? fmtPct(signal.maxDrawdown * 100) : "--"}</strong></div>
            </div>
            <div class="event-actions">
              <span>${t.workbench.topActions}</span>
              <div>${topActions.length ? topActions.map(([key, count]) => `<i style="background:${actionVisuals[key].color}">${actionVisuals[key].icon}</i>${count}`).join(" ") : "--"}</div>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderAttributionView() {
  const t = copy[lang];
  const signal = currentSignalStrategy();
  const stats = signal?.actionStats || {};
  const maxAbs = Math.max(1, ...actionOrder.map((key) => Math.abs(stats[key]?.estimatedPnL || 0)));
  return `
    <h3>${t.workbench.attributionTitle}</h3>
    <div class="attribution-scale"><span>${t.workbench.drag}</span><span>0</span><span>${t.workbench.gain}</span></div>
    <div class="attribution-list">
      ${actionOrder.map((key) => {
        const stat = stats[key] || { count: 0, estimatedPnL: 0 };
        const action = t.actions[key];
        const pnl = stat.estimatedPnL || 0;
        const side = pnl < 0 ? "loss" : pnl > 0 ? "gain" : "flat";
        const width = pnl === 0 ? 0 : Math.max(2, Math.abs(pnl) / maxAbs * 50).toFixed(1);
        return `
          <div class="attribution-row">
            <span class="action-icon" style="background:${actionVisuals[key].color}">${actionVisuals[key].icon}</span>
            <div class="attribution-main">
              <div><strong>${action.title}</strong><span>${stat.count} ${t.workbench.months}</span><span>${fmtSignedMoney(pnl)}</span></div>
              <div class="pnl-track"><i class="${side}" style="width:${width}%;background:${pnl < 0 ? "#b42318" : actionVisuals[key].color}"></i></div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderValidationView() {
  const t = copy[lang];
  const rows = backtestData.walkForward || [];
  if (!rows.length) return `<h3>${t.workbench.validationTitle}</h3><p class="muted">${t.workbench.noValidation}</p>`;
  return `
    <h3>${t.workbench.validationTitle}</h3>
    <div class="table-scroll">
      <table class="plain-table">
        <thead>
          <tr><th>${t.workbench.split}</th><th>${t.workbench.bestThresholds}</th><th>${t.workbench.trained}</th><th>${t.workbench.validation}</th><th>${t.workbench.defaultRule}</th><th>${t.workbench.vsQqq}</th></tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${row.split.slice(0, 4)}</td>
              <td>DD ${fmtPct(row.bestThresholds.deepDrawdown, 0)} / VIX ${fmtNumber(row.bestThresholds.panicVix, 0)}</td>
              <td>${fmtMoney(row.trainFinalValue)}</td>
              <td>${fmtMoney(row.validationFinalValue)}</td>
              <td>${fmtMoney(row.defaultValidationFinalValue)}</td>
              <td>${row.defaultValidationVsQqq == null ? "--" : `${fmtNumber(row.defaultValidationVsQqq, 2)}x`}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDataView() {
  const t = copy[lang];
  const q = backtestData.dataQuality || {};
  const series = ["nasdaq", "qqq", "tqqq", "vix", "rates", "cape"];
  const stale = backtestData.staleSources || [];
  return `
    <h3>${t.workbench.dataTitle}</h3>
    <div class="data-quality-grid">
      ${series.map((key) => {
        const item = q[key] || {};
        return `
          <div class="data-quality-item">
            <strong>${key.toUpperCase()}</strong>
            <span>${item.start || "--"} - ${item.end || "--"}</span>
            <small>${item.count || 0} ${t.workbench.observations}</small>
          </div>
        `;
      }).join("")}
    </div>
    <div class="data-note-grid">
      <div><span>${t.workbench.actualStart}</span><strong>QQQ ${q.qqqActualStart || "--"} / TQQQ ${q.tqqqActualStart || "--"}</strong></div>
      <div><span>${t.workbench.syntheticEnd}</span><strong>TQQQ ${q.tqqqSyntheticEnd || "--"}</strong></div>
      <div><span>${stale.length ? t.workbench.stale : t.workbench.fresh}</span><strong>${stale.length ? stale.join(", ") : "OK"}</strong></div>
    </div>
    <h4>${t.workbench.modelNotes}</h4>
    <ul class="model-notes">
      ${Object.values(backtestData.modelNotes || {}).map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
    </ul>
  `;
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvNumber(value, digits) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : "";
}

function exportCsv() {
  if (!backtestData) return;
  const headers = ["ruleset_id", "data_snapshot_id", "cost_bps", "execution_lag", "date", "strategy", "value", "nav", "cash", "qqq_value", "tqqq_value", "cash_weight", "qqq_weight", "tqqq_weight", "fees", "action_key", "action_decision_date", "action_execution_date", "qqq_price", "tqqq_source"];
  const rows = [headers];
  for (const strategy of visibleStrategies()) {
    for (const point of strategy.points) {
      rows.push([
        backtestData.rulesetId,
        backtestData.dataSnapshotId,
        backtestData.costBps,
        backtestData.executionLag,
        point.date,
        strategy.key,
        csvNumber(point.value, 2),
        csvNumber(point.nav, 8),
        csvNumber(point.cash, 2),
        csvNumber(point.qqqValue, 2),
        csvNumber(point.tqqqValue, 2),
        csvNumber(point.cashWeight, 8),
        csvNumber(point.qqqWeight, 8),
        csvNumber(point.tqqqWeight, 8),
        csvNumber(point.fees, 2),
        point.actionKey || "",
        point.actionDecisionDate || "",
        point.actionExecutionDate || "",
        csvNumber(point.qqqPrice, 4),
        point.tqqqSource || "",
      ]);
    }
  }
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `qqq-tqqq-backtest-${backtestData.start.slice(0, 4)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyShareLink() {
  updateShareUrl();
  const button = $("copyLinkBtn");
  try {
    await navigator.clipboard.writeText(window.location.href);
    button.textContent = copy[lang].linkCopied;
    setTimeout(() => { if (button.isConnected) button.textContent = copy[lang].copyLink; }, 1200);
  } catch {
    window.prompt(copy[lang].copyLink, window.location.href);
  }
}

function renderSensitivity() {
  const data = backtestData?.sensitivity;
  const el = $("sensitivity");
  if (!data) {
    el.replaceChildren();
    return;
  }
  const t = copy[lang];
  const rows = data.points.map((point) => `
    <tr>
      <td>${fmtPct(point.drawdownThreshold, 0)}</td>
      <td>${fmtNumber(point.panicVixThreshold, 0)}</td>
      <td>${fmtMoney(point.finalValue)}</td>
      <td>${point.bottomAttackCount}</td>
    </tr>
  `).join("");
  el.innerHTML = `
    <div>
      <h3>${t.sensitivityTitle}</h3>
      <p>${t.sensitivityNote}</p>
      <strong>${fmtMoney(data.minFinalValue)} - ${fmtMoney(data.maxFinalValue)}</strong>
    </div>
    <table>
      <thead><tr><th>DD</th><th>VIX</th><th>Final</th><th>Bottom</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function chartBounds(strategies, logScale = false) {
  let min = Infinity;
  let max = 1;
  for (const strategy of strategies) {
    for (const point of strategy.points) {
      max = Math.max(max, point.value);
      if (point.value > 0) min = Math.min(min, point.value);
    }
    if ($("trendInput").checked && hasRegression(strategy)) {
      for (const point of strategy.points) {
        const y = Math.exp(strategy.regression.intercept + strategy.regression.slope * point.year) * point.units;
        max = Math.max(max, y);
        if (y > 0) min = Math.min(min, y);
      }
    }
  }
  return { min: logScale ? Math.max(1, min * 0.85) : 0, max: max * 1.08 };
}

function renderChart() {
  const canvas = $("equityChart");
  const wrap = canvas.parentElement;
  const rect = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.onmousemove = null;
  canvas.onmouseleave = null;
  canvas.onpointermove = null;
  canvas.onpointerdown = null;
  canvas.onpointerleave = null;
  canvas.onkeydown = null;
  canvas.onfocus = null;
  $("tooltip").hidden = true;
  $("chartReadout").textContent = "";
  setChartState("");
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(320, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const showQqqAxis = $("qqqAxisInput").checked;
  const pad = { left: width < 620 ? 72 : 86, right: showQqqAxis ? 68 : 24, top: 24, bottom: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  ctx.clearRect(0, 0, width, height);

  const strategies = visibleStrategies().filter((strategy) => selected.has(strategy.key));
  if (!strategies.length) {
    setChartState(copy[lang].emptySelection);
    canvas.setAttribute("aria-label", copy[lang].emptySelection);
    return;
  }
  if (!strategies[0].points.length || plotW <= 0) {
    setChartState(copy[lang].emptyChart);
    canvas.setAttribute("aria-label", copy[lang].emptyChart);
    return;
  }
  canvas.setAttribute("aria-label", strategies.map((strategy) => {
    const last = strategy.points.at(-1);
    return `${copy[lang].strategies[strategy.key]} ${fmtMoney(last.value)}`;
  }).join("; "));
  const logScale = $("scaleInput").checked;
  const bounds = chartBounds(strategies, logScale);
  const pointCount = strategies[0].points.length;
  const qqqPrices = showQqqAxis ? strategies[0].points.map((point) => point.qqqPrice).filter((value) => Number.isFinite(value) && value > 0) : [];
  const qqqBounds = qqqPrices.length
    ? { min: Math.min(...qqqPrices) * 0.96, max: Math.max(...qqqPrices) * 1.04 }
    : null;
  const xFor = (i) => pad.left + (pointCount <= 1 ? 0 : i / (pointCount - 1)) * plotW;
  const yFor = (value) => {
    if (!logScale) return pad.top + plotH - (value - bounds.min) / (bounds.max - bounds.min) * plotH;
    const lo = Math.log(bounds.min);
    const hi = Math.log(bounds.max);
    return pad.top + plotH - (Math.log(Math.max(value, bounds.min)) - lo) / (hi - lo) * plotH;
  };

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
    const value = logScale
      ? Math.exp(Math.log(bounds.max) - ((Math.log(bounds.max) - Math.log(bounds.min)) * i) / 4)
      : bounds.max - ((bounds.max - bounds.min) * i) / 4;
    ctx.fillText(fmtCompactMoney(value), pad.left - 10, pad.top + (plotH * i) / 4);
  }

  if (qqqBounds) {
    ctx.textAlign = "left";
    ctx.fillStyle = "#667085";
    for (let i = 0; i <= 4; i += 1) {
      const value = qqqBounds.max - ((qqqBounds.max - qqqBounds.min) * i) / 4;
      ctx.fillText(`$${value.toFixed(0)}`, width - pad.right + 10, pad.top + (plotH * i) / 4);
    }
    ctx.save();
    ctx.translate(width - 14, pad.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("QQQ", 0, 0);
    ctx.restore();
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const labels = [0, Math.floor((pointCount - 1) / 2), pointCount - 1];
  const uniqueLabels = [...new Set(labels)];
  const useMonthLabel = new Set(uniqueLabels.map((i) => (strategies[0].points[i]?.date || "").slice(0, 4))).size < uniqueLabels.length;
  for (const i of uniqueLabels) {
    const date = strategies[0].points[i]?.date || "";
    ctx.fillText(useMonthLabel ? date.slice(0, 7) : date.slice(0, 4), xFor(i), height - pad.bottom + 14);
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

    if ($("trendInput").checked && hasRegression(strategy)) {
      ctx.lineWidth = 1.4;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      strategy.points.forEach((point, i) => {
        const yValue = Math.exp(strategy.regression.intercept + strategy.regression.slope * point.year);
        const accountValue = yValue * point.units;
        const x = xFor(i);
        const y = yFor(accountValue);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (qqqBounds) {
    const yQqq = (value) => pad.top + plotH - (value - qqqBounds.min) / (qqqBounds.max - qqqBounds.min) * plotH;
    ctx.strokeStyle = "#667085";
    ctx.lineWidth = 1.8;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    let hasQqqPoint = false;
    strategies[0].points.forEach((point, i) => {
      if (!Number.isFinite(point.qqqPrice) || point.qqqPrice <= 0) return;
      const x = xFor(i);
      const y = yQqq(point.qqqPrice);
      if (!hasQqqPoint) {
        ctx.moveTo(x, y);
        hasQqqPoint = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  let keyboardIndex = pointCount - 1;
  const renderIndex = (index, x = xFor(index), y = pad.top + 24) => {
    const signalPoint = backtestData.strategies.find((strategy) => strategy.key === "signal")?.points[index];
    const action = signalPoint?.actionKey ? copy[lang].actions[signalPoint.actionKey] : null;
    const visual = signalPoint?.actionKey ? actionVisuals[signalPoint.actionKey] : null;
    const actionRow = showActionMarkers && action && visual
      ? `<div class="tooltip-action"><span class="tooltip-action-dot" style="background:${visual.color}"></span><div><strong>${action.title}</strong><br><span>${action.operation}</span></div></div>`
      : "";
    const rows = strategies.map((strategy) => {
      const point = strategy.points[index];
      return `<div><span style="color:${colors[strategy.key]}">●</span> ${copy[lang].strategies[strategy.key]}: <strong>${fmtMoney(point.value)}</strong></div>`;
    }).join("");
    const qqqRow = showQqqAxis && Number.isFinite(strategies[0].points[index].qqqPrice)
      ? `<div><span style="color:#98a2b3">●</span> QQQ: <strong>${fmtMoney(strategies[0].points[index].qqqPrice)}</strong></div>`
      : "";
    const tip = $("tooltip");
    const dateLabel = fmtDate(strategies[0].points[index].date);
    tip.innerHTML = `<strong>${dateLabel}</strong>${actionRow}${rows}${qqqRow}`;
    $("chartReadout").innerHTML = `<strong>${dateLabel}</strong>${actionRow}${rows}${qqqRow}`;
    tip.hidden = false;
    const tipW = tip.offsetWidth || 280;
    const tipH = tip.offsetHeight || 80;
    tip.style.left = `${Math.min(width - tipW - 8, Math.max(8, x + 14))}px`;
    tip.style.top = `${Math.min(height - tipH - 8, Math.max(8, y - 20))}px`;
  };
  const showTooltip = (event) => {
    const chartRect = canvas.getBoundingClientRect();
    const x = event.clientX - chartRect.left;
    if (x < pad.left || x > width - pad.right) {
      $("tooltip").hidden = true;
      return;
    }
    keyboardIndex = Math.max(0, Math.min(pointCount - 1, Math.round(((x - pad.left) / plotW) * (pointCount - 1))));
    renderIndex(keyboardIndex, x, event.clientY - chartRect.top);
  };
  canvas.onpointermove = showTooltip;
  canvas.onpointerdown = showTooltip;
  canvas.onpointerleave = () => { $("tooltip").hidden = true; };
  canvas.onmousemove = showTooltip;
  canvas.onmouseleave = () => { $("tooltip").hidden = true; };
  canvas.onfocus = () => renderIndex(keyboardIndex);
  canvas.onkeydown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") keyboardIndex = 0;
    else if (event.key === "End") keyboardIndex = pointCount - 1;
    else keyboardIndex = Math.max(0, Math.min(pointCount - 1, keyboardIndex + (event.key === "ArrowRight" ? 1 : -1)));
    renderIndex(keyboardIndex);
  };
}

async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      throw new Error("Invalid JSON response");
    }
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error(lang === "zh" ? "请求超时，请刷新后重试。" : "Request timed out. Refresh and try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadMarket() {
  try {
    marketData = await fetchJson("/api/market");
    currentOrderPlan = null;
    renderStatic();
    return true;
  } catch (error) {
    showError(error.message);
    return false;
  }
}

async function loadBacktest() {
  const requestId = ++backtestRequestId;
  const start = $("startInput").value;
  const cost = $("costInput").value;
  setBacktestLoading(true);
  try {
    const data = await fetchJson(`/api/backtest?start=${encodeURIComponent(start)}&cost=${encodeURIComponent(cost)}`);
    if (requestId !== backtestRequestId) return;
    backtestData = data;
    renderBacktest();
    return true;
  } catch (error) {
    if (requestId !== backtestRequestId) return;
    showError(error.message);
    setChartState(error.message);
    return false;
  } finally {
    if (requestId === backtestRequestId) setBacktestLoading(false);
  }
}

async function loadAll() {
  clearError();
  return Promise.all([loadMarket(), loadBacktest()]);
}

async function refreshAllData() {
  const button = $("refreshDataBtn");
  button.disabled = true;
  button.textContent = copy[lang].refreshingData;
  try {
    await loadAll();
  } finally {
    button.disabled = false;
    button.textContent = copy[lang].refreshData;
  }
}

$("zhBtn").addEventListener("click", () => { setLang("zh"); });
$("enBtn").addEventListener("click", () => { setLang("en"); });
$("refreshDataBtn").addEventListener("click", refreshAllData);
$("startInput").addEventListener("change", () => {
  updateShareUrl();
  loadBacktest();
});
$("costInput").addEventListener("change", () => {
  currentOrderPlan = null;
  updateShareUrl();
  renderOrderDraft();
  loadBacktest();
});
$("trendInput").addEventListener("change", () => {
  updateShareUrl();
  renderBacktest();
});
$("scaleInput").addEventListener("change", () => {
  updateShareUrl();
  renderBacktest();
});
$("qqqAxisInput").addEventListener("change", () => {
  updateShareUrl();
  renderBacktest();
});
$("actionsInput").addEventListener("change", (event) => {
  showActionMarkers = event.currentTarget.checked;
  updateShareUrl();
  renderBacktest();
});
$("accountForm").addEventListener("submit", planCurrentOrders);
for (const id of ["cashInput", "qqqSharesInput", "tqqqSharesInput", "monthlyContributionInput"]) {
  $(id).addEventListener("input", () => {
    currentOrderPlan = null;
    renderOrderDraft();
  });
}
$("fractionalSharesInput").addEventListener("change", () => {
  currentOrderPlan = null;
  renderOrderDraft();
});
$("executionCostInput").addEventListener("change", () => {
  currentOrderPlan = null;
  renderOrderDraft();
});
$("riskProfileInput").addEventListener("change", () => {
  currentOrderPlan = null;
  renderRiskProfileNote();
  renderOrderDraft();
});
$("clearAccountBtn").addEventListener("click", clearAccountData);
$("calendarBtn").addEventListener("click", exportMonthlyCalendar);
$("recordPlanBtn").addEventListener("click", recordCurrentPlan);
$("clearJournalBtn").addEventListener("click", clearJournal);
window.addEventListener("resize", () => {
  if (!backtestData || resizeFrame) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    renderChart();
    drawWeightChart();
  });
});

applyUrlParams();
restoreAccountForm();
renderStatic();
loadAll();
