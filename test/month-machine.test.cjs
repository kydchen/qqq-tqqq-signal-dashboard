const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSignalMachine,
  signalMachineClose,
  signalMachineDue,
} = require("../api/_lib");

// Regression tests for the unified monthly signal machine. They freeze the
// event order shared by the live panel and the backtest:
//
//   session open:  month-start contribution -> execute the pending order from
//                  the previous close (even when that close was last month)
//   session close: advance month state -> lock or upgrade the month's action
//                  -> schedule execution for the next trading session
//
// Signal memory advances when a decision is confirmed at a close; portfolio
// trades execute at the next session. A carry-in order from the previous
// month must never swallow the new month's own month-start lock.

const NORMAL = { capePercentile: 50, drawdownPct: -3, crash25dPct: 0, vix: 18, vixAvailable: true };
const BOTTOM = { capePercentile: 10, drawdownPct: -35, crash25dPct: -3, vix: 45, vixAvailable: true };
const MILD_DIP = { capePercentile: 50, drawdownPct: -14, crash25dPct: 0, vix: 18, vixAvailable: true };

test("month-start lock schedules next-session execution and stays put", () => {
  const machine = createSignalMachine();
  const scheduled = signalMachineClose(machine, NORMAL, "2024-10-01");
  assert.equal(scheduled.decision.key, "normalDca");
  assert.equal(scheduled.decisionDate, "2024-10-01");
  assert.equal(machine.monthAction, "normalDca");
  assert.equal(machine.lockedDecision.key, "normalDca");
  assert.equal(machine.upgraded, false);

  // Same close never executes its own order; the next session consumes it.
  assert.equal(signalMachineDue(machine, "2024-10-01"), null);
  const due = signalMachineDue(machine, "2024-10-02");
  assert.equal(due.decision.key, "normalDca");
  assert.equal(due.decisionDate, "2024-10-01");
  assert.equal(signalMachineDue(machine, "2024-10-02"), null);
});

test("cross-month carry-in executes but never swallows the new month's own lock", () => {
  const machine = createSignalMachine();
  signalMachineClose(machine, NORMAL, "2024-10-30");
  signalMachineDue(machine, "2024-10-31");

  // Month-end upgrade: October escalates to a dip buy on its last close.
  const upgraded = signalMachineClose(machine, MILD_DIP, "2024-10-31");
  assert.equal(upgraded.decision.key, "smallDipBuy");
  assert.equal(upgraded.month, "2024-10");
  assert.equal(machine.monthAction, "smallDipBuy");
  assert.equal(machine.upgraded, true);

  // The October order executes on the first November session as a carry-in.
  const carryIn = signalMachineDue(machine, "2024-11-01");
  assert.equal(carryIn.decision.key, "smallDipBuy");
  assert.equal(carryIn.decisionDate, "2024-10-31");

  // November still locks its own month-start action at its first close.
  const ownLock = signalMachineClose(machine, NORMAL, "2024-11-01");
  assert.equal(ownLock.decision.key, "normalDca");
  assert.equal(ownLock.month, "2024-11");
  assert.equal(machine.monthAction, "normalDca");
  assert.equal(machine.lockedDecision.key, "normalDca");
  assert.equal(machine.upgraded, false);
});

test("cross-month bottomAttack carry-in leaves the new month in post-bottom ramp", () => {
  const machine = createSignalMachine();
  signalMachineClose(machine, NORMAL, "2024-10-30");
  signalMachineDue(machine, "2024-10-31");
  signalMachineClose(machine, BOTTOM, "2024-10-31");
  const carryIn = signalMachineDue(machine, "2024-11-01");
  assert.equal(carryIn.decision.key, "bottomAttack");
  // November's own lock is the post-bottom ramp continuation, decided by
  // November itself rather than swallowed by the carry-in.
  const ownLock = signalMachineClose(machine, NORMAL, "2024-11-01");
  assert.equal(ownLock.decision.key, "rampTqqq");
  assert.equal(ownLock.month, "2024-11");
  assert.equal(machine.upgraded, false);
});

test("bottomAttack ramps TQQQ for exactly six following months", () => {
  const machine = createSignalMachine();
  const keys = [signalMachineClose(machine, BOTTOM, "2024-01-02").decision.key];
  for (const date of ["2024-02-01", "2024-03-01", "2024-04-01", "2024-05-01", "2024-06-01", "2024-07-01", "2024-08-01"]) {
    signalMachineDue(machine, date);
    keys.push(signalMachineClose(machine, NORMAL, date)?.decision.key || machine.monthAction);
  }
  assert.deepEqual(keys, ["bottomAttack", "rampTqqq", "rampTqqq", "rampTqqq", "rampTqqq", "rampTqqq", "rampTqqq", "normalDca"]);
});

test("signal memory advances at decision confirmation, not at execution", () => {
  const machine = createSignalMachine();
  signalMachineClose(machine, BOTTOM, "2024-01-31");
  // The order is still pending, yet the ramp countdown has already started.
  assert.equal(machine.memory.rampMonths, 6);
  assert.equal(machine.pending.decision.key, "bottomAttack");
});

test("intra-month upgrade replaces the pending order before execution", () => {
  const machine = createSignalMachine();
  signalMachineClose(machine, NORMAL, "2024-10-01");
  signalMachineDue(machine, "2024-10-02");
  const upgraded = signalMachineClose(machine, MILD_DIP, "2024-10-02");
  assert.equal(upgraded.decision.key, "smallDipBuy");
  assert.equal(machine.upgraded, true);
  const due = signalMachineDue(machine, "2024-10-03");
  assert.equal(due.decision.key, "smallDipBuy");
  assert.equal(due.decisionDate, "2024-10-02");
});

test("a pending order left at the end of data simply stays unexecuted", () => {
  const machine = createSignalMachine();
  signalMachineClose(machine, NORMAL, "2024-10-31");
  assert.equal(machine.pending.decision.key, "normalDca");
  assert.equal(signalMachineDue(machine, "2024-10-31"), null);
  assert(machine.pending);
});
