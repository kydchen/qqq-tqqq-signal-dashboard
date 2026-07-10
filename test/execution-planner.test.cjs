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

test("pause action retains the monthly contribution as cash", () => {
  const result = plan({ decision: { key: "pauseAtHigh", rampMonths: 0 } });
  assert.equal(result.orders.length, 0);
  assert.equal(result.retainedCash, 1000);
});

test("invalid account values fail loudly", () => {
  assert.throws(() => plan({
    account: { cash: -1, qqqShares: 0, tqqqShares: 0, monthlyContribution: 1000, fractionalShares: true },
  }), /Cash must be between/);
});

test("invalid risk policy and trading cost fail loudly", () => {
  assert.throws(() => plan({
    policy: { ...policies.standard, normalTqqqFloor: 0.5 },
  }), /cannot exceed/);
  assert.throws(() => plan({ costBps: 7 }), /must be 0, 5, or 10/);
});

test("calendar export is recurring, local, and starts on a weekday", () => {
  const ics = calendarIcs({ lang: "en", now: new Date("2026-07-10T00:00:00Z") });
  assert.match(ics, /DTSTART:20260803T130000Z/);
  assert.match(ics, /RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1/);
  assert.match(ics, /BEGIN:VALARM/);
});
