const test = require("node:test");
const assert = require("node:assert/strict");
const { calendarIcs, planOrders } = require("../assets/execution");

const quotes = {
  qqq: { date: "2026-07-09", price: 700 },
  tqqq: { date: "2026-07-09", price: 75 },
};

const policies = {
  conservative: { maxTqqq: 0, normalTqqqFloor: 0, bottomTqqqTarget: 0, rampTqqqTarget: 0 },
  standard: { maxTqqq: 0.4, normalTqqqFloor: 0.1, bottomTqqqTarget: 0.25, rampTqqqTarget: 0.4 },
  aggressive: { maxTqqq: 0.9, normalTqqqFloor: 0.2, bottomTqqqTarget: 0.35, rampTqqqTarget: 0.9 },
};

function plan(overrides = {}) {
  return planOrders({
    account: { cash: 0, qqqShares: 10, tqqqShares: 0, monthlyContribution: 1000, fractionalShares: true },
    policy: policies.standard,
    decision: { key: "normalDca", rampMonths: 0 },
    quotes,
    costBps: 5,
    ...overrides,
  });
}

test("normal plan stays within the risk cap and never creates negative balances", () => {
  const result = plan();
  assert(result.orders.length > 0);
  assert(result.ending.cash >= 0);
  assert(result.ending.qqqValue >= 0);
  assert(result.ending.tqqqValue >= 0);
  assert(result.ending.tqqqWeight <= policies.standard.maxTqqq + 1e-9);
  assert.equal(result.quoteDate, "2026-07-09");
});

test("conservative policy removes existing TQQQ before applying the monthly action", () => {
  const result = plan({
    account: { cash: 0, qqqShares: 1, tqqqShares: 20, monthlyContribution: 1000, fractionalShares: true },
    policy: policies.conservative,
  });
  assert(result.orders.some((order) => order.side === "SELL" && order.symbol === "TQQQ"));
  assert.equal(result.ending.tqqqValue, 0);
});

test("pause action keeps core QQQ participation and retains half the contribution", () => {
  const result = plan({ decision: { key: "pauseAtHigh", rampMonths: 0 } });
  const buy = result.orders.find((order) => order.side === "BUY" && order.symbol === "QQQ");
  assert(buy);
  assert(buy.notional + buy.estimatedCost <= 500 + 0.01);
  assert(result.retainedCash >= 499 && result.retainedCash <= 501);
});

test("heat trim buys core QQQ while reducing TQQQ", () => {
  const result = plan({
    account: { cash: 0, qqqShares: 10, tqqqShares: 100, monthlyContribution: 1000, fractionalShares: true },
    policy: policies.aggressive,
    decision: { key: "trimHeat", rampMonths: 0 },
  });
  assert(result.orders.some((order) => order.side === "BUY" && order.symbol === "QQQ"));
  assert(result.orders.some((order) => order.side === "SELL" && order.symbol === "TQQQ"));
});

test("invalid account values fail loudly", () => {
  assert.throws(() => plan({
    account: { cash: -1, qqqShares: 0, tqqqShares: 0, monthlyContribution: 1000, fractionalShares: true },
  }), /Cash must be between/);
  assert.throws(
    () => plan({ account: { cash: -1, qqqShares: 0, tqqqShares: 0, monthlyContribution: 1000, fractionalShares: true } }),
    (error) => error.code === "RANGE" && error.field === "Cash",
  );
});

test("invalid risk policy and trading cost fail loudly", () => {
  assert.throws(() => plan({
    policy: { ...policies.standard, normalTqqqFloor: 0.5 },
  }), /cannot exceed/);
  assert.throws(() => plan({ costBps: 7 }), /must be 0, 5, or 10/);
  assert.throws(
    () => plan({ policy: { ...policies.standard, normalTqqqFloor: 0.5 } }),
    (error) => error.code === "TARGETS_EXCEED_CAP",
  );
  assert.throws(() => plan({ costBps: 7 }), (error) => error.code === "COST_CHOICE");
});

test("ramp rotation cannot spend cash outside the staged budget", () => {
  const result = plan({
    account: { cash: 60000, qqqShares: 10, tqqqShares: 0, monthlyContribution: 1000, fractionalShares: true },
    policy: policies.aggressive,
    decision: { key: "rampTqqq", rampMonths: 5 },
  });
  const tqqqBuys = result.orders
    .filter((order) => order.side === "BUY" && order.symbol === "TQQQ")
    .reduce((sum, order) => sum + order.notional + order.estimatedCost, 0);
  const qqqSaleProceeds = result.orders
    .filter((order) => order.side === "SELL" && order.symbol === "QQQ")
    .reduce((sum, order) => sum + order.notional - order.estimatedCost, 0);
  const stagedCashBudget = 1000 + 60000 / 6;
  assert(tqqqBuys <= stagedCashBudget + qqqSaleProceeds + 0.02);
  assert(result.retainedCash > 40000);
});

test("risk cap sale accounts for friction and ends at or below the cap", () => {
  const result = plan({
    account: { cash: 0, qqqShares: 0, tqqqShares: 100, monthlyContribution: 0, fractionalShares: true },
    policy: policies.standard,
    decision: { key: "pauseAtHigh", rampMonths: 0 },
  });
  assert(result.ending.tqqqWeight <= policies.standard.maxTqqq + 1e-9);
});

test("every action path preserves non-negative balances with whole shares", () => {
  for (const key of ["bottomAttack", "rampTqqq", "smallDipBuy", "crashDefense", "trimHeat", "pauseAtHigh", "normalDca"]) {
    const result = plan({
      account: { cash: 5000, qqqShares: 10, tqqqShares: 20, monthlyContribution: 1000, fractionalShares: false },
      policy: policies.aggressive,
      decision: { key, rampMonths: 4 },
    });
    assert(result.ending.cash >= 0, `${key} cash`);
    assert(result.ending.qqqValue >= 0, `${key} QQQ`);
    assert(result.ending.tqqqValue >= 0, `${key} TQQQ`);
    assert(result.orders.every((order) => Number.isInteger(order.shares)), `${key} whole shares`);
  }
});

test("calendar export is recurring, local, and starts on a weekday", () => {
  const ics = calendarIcs({ lang: "en", now: new Date("2026-07-10T00:00:00Z") });
  assert.match(ics, /DTSTART;TZID=America\/New_York:20260803T090000/);
  assert.match(ics, /RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1/);
  assert.match(ics, /BEGIN:VALARM/);
});
