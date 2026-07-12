(function attachExecutionPlanner(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ExecutionPlanner = api;
}(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const ACTIONS = new Set(["bottomAttack", "rampTqqq", "smallDipBuy", "crashDefense", "trimHeat", "pauseAtHigh", "normalDca"]);
  const DEFAULT_CORE_QQQ_HIGH_REGIME_FRACTION = 0.5;

  function finiteNonNegative(value, label, max = 1e12) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > max) throw new Error(`${label} must be between 0 and ${max}.`);
    return number;
  }

  function roundShares(value, fractional) {
    const factor = fractional ? 1000 : 1;
    return Math.floor(Math.max(0, value) * factor + 1e-9) / factor;
  }

  function weights(state, prices) {
    const qqqValue = state.qqqShares * prices.qqq;
    const tqqqValue = state.tqqqShares * prices.tqqq;
    const total = state.cash + qqqValue + tqqqValue;
    return {
      cash: state.cash,
      qqqValue,
      tqqqValue,
      total,
      cashWeight: total > 0 ? state.cash / total : 0,
      qqqWeight: total > 0 ? qqqValue / total : 0,
      tqqqWeight: total > 0 ? tqqqValue / total : 0,
    };
  }

  function planOrders(input) {
    if (!ACTIONS.has(input?.decision?.key)) throw new Error("Current action is unavailable.");
    if (!input.policy) throw new Error("Risk policy is unavailable.");
    const policy = {
      maxTqqq: finiteNonNegative(input.policy.maxTqqq, "Maximum TQQQ weight", 1),
      normalTqqqFloor: finiteNonNegative(input.policy.normalTqqqFloor, "Normal TQQQ floor", 1),
      bottomTqqqTarget: finiteNonNegative(input.policy.bottomTqqqTarget, "Bottom TQQQ target", 1),
      rampTqqqTarget: finiteNonNegative(input.policy.rampTqqqTarget, "Ramp TQQQ target", 1),
    };
    if (policy.normalTqqqFloor > policy.maxTqqq || policy.bottomTqqqTarget > policy.maxTqqq || policy.rampTqqqTarget > policy.maxTqqq) {
      throw new Error("TQQQ targets cannot exceed the risk policy cap.");
    }
    const prices = {
      qqq: finiteNonNegative(input.quotes?.qqq?.price, "QQQ price"),
      tqqq: finiteNonNegative(input.quotes?.tqqq?.price, "TQQQ price"),
    };
    if (prices.qqq <= 0 || prices.tqqq <= 0) throw new Error("Current ETF quotes are unavailable.");
    const state = {
      cash: finiteNonNegative(input.account?.cash, "Cash"),
      qqqShares: finiteNonNegative(input.account?.qqqShares, "QQQ shares"),
      tqqqShares: finiteNonNegative(input.account?.tqqqShares, "TQQQ shares"),
    };
    const monthly = finiteNonNegative(input.account?.monthlyContribution, "Monthly contribution", 1e8);
    const coreQqqHighRegimeFraction = finiteNonNegative(
      input.coreQqqHighRegimeFraction ?? DEFAULT_CORE_QQQ_HIGH_REGIME_FRACTION,
      "Core QQQ high-regime fraction",
      1,
    );
    const fractional = input.account?.fractionalShares !== false;
    const costBps = finiteNonNegative(input.costBps ?? 5, "Trading cost", 10);
    if (![0, 5, 10].includes(costBps)) throw new Error("Trading cost must be 0, 5, or 10 basis points.");
    const costRate = costBps / 10000;
    const orders = [];
    const starting = weights(state, prices);
    state.cash += monthly;

    const addOrder = (side, symbol, shares, price, fee) => {
      if (shares <= 0) return;
      orders.push({ side, symbol, shares, price, notional: shares * price, estimatedCost: fee });
    };
    const buy = (symbol, budget) => {
      const key = symbol === "QQQ" ? "qqqShares" : "tqqqShares";
      const price = symbol === "QQQ" ? prices.qqq : prices.tqqq;
      const spend = Math.max(0, Math.min(state.cash, budget));
      const shares = roundShares(spend / (price * (1 + costRate)), fractional);
      const notional = shares * price;
      const fee = notional * costRate;
      if (notional + fee > state.cash + 1e-7 || shares <= 0) return 0;
      state.cash -= notional + fee;
      state[key] += shares;
      addOrder("BUY", symbol, shares, price, fee);
      return notional;
    };
    const sell = (symbol, grossValue, roundUp = false) => {
      const key = symbol === "QQQ" ? "qqqShares" : "tqqqShares";
      const price = symbol === "QQQ" ? prices.qqq : prices.tqqq;
      const available = state[key];
      const rawShares = Math.min(available * price, Math.max(0, grossValue)) / price;
      const factor = fractional ? 1000 : 1;
      const shares = Math.min(available, roundUp
        ? Math.ceil(Math.max(0, rawShares) * factor - 1e-9) / factor
        : roundShares(rawShares, fractional));
      const notional = shares * price;
      const fee = notional * costRate;
      if (shares <= 0) return 0;
      state[key] -= shares;
      state.cash += notional - fee;
      addOrder("SELL", symbol, shares, price, fee);
      return notional;
    };
    const spendWithDrip = (spareFraction = 1 / 6) => Math.min(state.cash, monthly + Math.max(0, state.cash - monthly) * spareFraction);
    const buyTqqqToTarget = (targetPct, rotationPct = 0, cashLimit = Infinity) => {
      let current = weights(state, prices);
      const target = current.total * Math.min(policy.maxTqqq, targetPct);
      let need = Math.max(0, target - current.tqqqValue);
      if (need <= 0) return;
      buy("TQQQ", Math.min(state.cash, need, cashLimit));
      current = weights(state, prices);
      need = Math.max(0, target - current.tqqqValue);
      if (need <= 0 || rotationPct <= 0) return;
      const cashBeforeRotation = state.cash;
      const rotated = sell("QQQ", Math.min(current.qqqValue * rotationPct, need));
      const rotationProceeds = Math.max(0, state.cash - cashBeforeRotation);
      if (rotated > 0) buy("TQQQ", Math.min(rotationProceeds, need));
    };

    const beforeCap = weights(state, prices);
    const maxTqqqValue = beforeCap.total * policy.maxTqqq;
    if (beforeCap.tqqqValue > maxTqqqValue) {
      const excess = beforeCap.tqqqValue - maxTqqqValue;
      const grossSale = excess / Math.max(1e-9, 1 - policy.maxTqqq * costRate);
      sell("TQQQ", grossSale, true);
    }

    const key = input.decision.key;
    if (key === "bottomAttack") {
      if (policy.maxTqqq === 0) buy("QQQ", spendWithDrip(1 / 3));
      else buyTqqqToTarget(policy.bottomTqqqTarget, 0.25, state.cash / 3);
    } else if (key === "rampTqqq") {
      if (policy.maxTqqq === 0) buy("QQQ", spendWithDrip());
      else buyTqqqToTarget(policy.rampTqqqTarget, 1 / Math.max(1, input.decision.rampMonths || 6), spendWithDrip());
    } else if (key === "smallDipBuy") {
      buy("QQQ", Math.min(state.cash, monthly * 2));
    } else if (key === "crashDefense") {
      sell("TQQQ", state.tqqqShares * prices.tqqq * 0.5);
    } else if (key === "trimHeat") {
      buy("QQQ", Math.min(state.cash, monthly * coreQqqHighRegimeFraction));
      const current = weights(state, prices);
      const floorValue = current.total * policy.normalTqqqFloor;
      sell("TQQQ", Math.max(0, Math.min(current.tqqqValue / 12, current.tqqqValue - floorValue)));
    } else if (key === "pauseAtHigh") {
      buy("QQQ", Math.min(state.cash, monthly * coreQqqHighRegimeFraction));
    } else if (key === "normalDca") {
      if (policy.maxTqqq > 0) buyTqqqToTarget(policy.normalTqqqFloor);
      buy("QQQ", spendWithDrip());
    }

    const ending = weights(state, prices);
    const floorValue = ending.total * policy.normalTqqqFloor;
    return {
      orders,
      starting,
      ending,
      retainedCash: ending.cash,
      distanceToTqqqFloor: Math.max(0, floorValue - ending.tqqqValue),
      contributed: monthly,
      costBps,
      quoteDate: input.quotes.qqq.date === input.quotes.tqqq.date ? input.quotes.qqq.date : null,
    };
  }

  function calendarIcs({ title, description, lang = "zh", now = new Date() } = {}) {
    const uid = `qqq-tqqq-monthly-${Date.now()}@local`;
    const escape = (value) => String(value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
    const summary = title || (lang === "zh" ? "QQQ/TQQQ 月初检查（休市顺延）" : "QQQ/TQQQ month-open review (shift if market closed)");
    const details = description || (lang === "zh" ? "打开本地操作台，核对数据日期、月初动作、风险档和订单草稿。" : "Open the local cockpit and verify data dates, month-open action, risk policy, and order draft.");
    const firstReview = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    while (firstReview.getUTCDay() === 0 || firstReview.getUTCDay() === 6) firstReview.setUTCDate(firstReview.getUTCDate() + 1);
    const dtStart = `${firstReview.toISOString().slice(0, 10).replace(/-/g, "")}T090000`;
    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//QQQ TQQQ Cockpit//Monthly Review//EN",
      "CALSCALE:GREGORIAN",
      "X-WR-TIMEZONE:America/New_York",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTART;TZID=America/New_York:${dtStart}`,
      "DURATION:PT20M",
      "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1",
      `SUMMARY:${escape(summary)}`,
      `DESCRIPTION:${escape(details)}`,
      "BEGIN:VALARM",
      "TRIGGER:-PT30M",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escape(summary)}`,
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
  }

  return { calendarIcs, planOrders };
}));
