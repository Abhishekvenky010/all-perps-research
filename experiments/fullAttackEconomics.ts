/*
 * ============================================================
 * FULL ATTACK ECONOMICS
 * ============================================================
 *
 * Prints the sweep built in ./attackEconomicsModel.ts.
 *
 * The question:
 *
 *   Can an attacker push the AMM TWAP away from the honest
 *   price, extract that gap in the perp, and come out ahead
 *   once execution impact, their own self-flow, the cost of
 *   sustaining the manipulation, and liquidation risk are all
 *   priced in?
 *
 * The economic condition under test:
 *
 *   cost of sustaining manipulation > profit from perp
 *
 * The model, the arithmetic TWAP inversion and the sweep live
 * in ./attackEconomicsModel.ts so that
 * tests/attackEconomics.test.ts can assert the invariant
 * without reimplementing any of it.
 *
 * The invariants themselves are enforced in that test rather
 * than here: assertions in a printing script are easy to skip
 * and easy to delete, whereas a failing test is not.
 */

import {
  runAttackSweep,
  runCapacityAttackSweep,
  requiredSpotForTwap,
  replayTwap,
  INITIAL_SPOT_PRICE,
  MAINTENANCE_MARGIN,
  config,
} from "./attackEconomicsModel.js";

import type { AttackRow } from "./attackEconomicsModel.js";

const rows = runAttackSweep();

const reachable = rows.filter((row) => row.reachable);

function count(
  predicate: (row: AttackRow) => boolean,
): string {
  return `${reachable.filter(predicate).length} of ${reachable.length}`;
}

console.log("\n=== REACHABLE ATTACKS ===");

console.table(
  reachable.map((row) => ({
    target: row.targetTwap,
    duration: row.duration,
    requiredSpot: Number(row.requiredSpot.toFixed(3)),
    oracleTwap: Number(row.oracleTwap.toFixed(6)),
    oracleErr: row.oracleError.toExponential(1),
    selfFlowUsage:
      row.selfFlowUsagePct === null
        ? null
        : Number(row.selfFlowUsagePct.toFixed(1)),
    entry: Number(row.entryPrice.toFixed(3)),
    exit: Number(row.exitPrice.toFixed(3)),
    pnl: Number(row.roundTripPnl.toFixed(0)),
    attackCost: Number(row.attackCost.toFixed(0)),
    ratio:
      Number.isFinite(row.costToProfitRatio)
        ? Number(row.costToProfitRatio.toFixed(2))
        : "n/a",
    naivePnl: row.naivePnlPositive,
    liqOnEntry: row.liquidatedOnEntry,
    marginAtMark: Number(
      row.marginRatioAtManipulatedMark.toFixed(3),
    ),
    realizable: row.realizable,
  })),
);

console.log("\n=== UNREACHABLE TARGETS ===");

console.table(
  rows
    .filter((row) => !row.reachable)
    .map((row) => ({
      target: row.targetTwap,
      duration: row.duration,
      requiredSpot: Number(row.requiredSpot.toFixed(2)),
      note: row.note,
    })),
);

console.log("\n=== SELF-FLOW FEASIBILITY ===");

console.log(
  "Reachable attacks whose required price move needs more " +
    "open interest than the market has:",
  count((row) => !row.selfFlowFeasible),
);

console.log("\n=== LIQUIDATION ===");

console.log(
  "Reachable attacks where the attacker is liquidated on the " +
    "way back up:",
  count((row) => row.liquidated),
);

console.log(
  "Reachable attacks already liquidatable at the entry " +
    "mark, before any recovery:",
  count((row) => row.liquidatedOnEntry),
);

console.log(
  "Reachable attacks showing a positive headline PnL:",
  count((row) => row.naivePnlPositive),
);

/*
 * The oracle check and the self-flow check are re-run here as
 * a visible summary. Both are asserted in the test suite.
 */

console.log("\n=== ORACLE AND SELF-FLOW CHECKS ===");

let oracleChecks = 0;
let oracleFailures = 0;
let selfFlowChecks = 0;
let selfFlowFailures = 0;

for (const duration of [
  15, 30, 60, 120, 300, 600, 900,
]) {
  for (const targetTwap of [90, 80, 70, 60, 50, 40]) {
    const requiredSpot =
      requiredSpotForTwap(targetTwap, duration);

    if (
      requiredSpot <= 0 ||
      requiredSpot >= INITIAL_SPOT_PRICE
    ) {
      continue;
    }

    oracleChecks++;

    if (
      Math.abs(
        replayTwap(requiredSpot, duration, false) -
          targetTwap,
      ) > 0.01
    ) {
      oracleFailures++;
    }

    selfFlowChecks++;

    if (
      replayTwap(requiredSpot, duration, true) >
      replayTwap(requiredSpot, duration, false) +
        1e-9
    ) {
      selfFlowFailures++;
    }
  }
}

console.log(
  `oracle reproduced ${oracleChecks - oracleFailures} of ` +
    `${oracleChecks} targets within 0.01`,
);

console.log(
  `self-flow never raised the TWAP in ` +
    `${selfFlowChecks - selfFlowFailures} of ` +
    `${selfFlowChecks} cases`,
);

/*
 * A one-time cost model would leave the ratio below 1 in the
 * shallowest, longest manipulation, which is the case closest
 * to plausible. Report the thin margin explicitly rather than
 * letting the table hide it.
 */

const thinnest = reachable.reduce((a, b) =>
  Number.isFinite(a.costToProfitRatio) &&
  Number.isFinite(b.costToProfitRatio) &&
  b.costToProfitRatio < a.costToProfitRatio
    ? b
    : a,
);

console.log("\n=== THINNEST MARGIN ===");

console.log(
  `TWAP ${thinnest.targetTwap} over ${thinnest.duration}s: ` +
    `attack cost ${thinnest.attackCost.toFixed(0)} vs ` +
    `extraction ${thinnest.roundTripPnl.toFixed(0)}, ` +
    `ratio ${thinnest.costToProfitRatio.toFixed(2)}x`,
);

console.log(
  `maintenance margin in force: ${MAINTENANCE_MARGIN}`,
);

/* ============================================================
 * CAPACITY AXIS
 *
 * The cost sweep reports a headline PnL whether or not the
 * attack can actually be put on. This sweep varies only
 * capacity utilization and records executability separately
 * from profit, because the two fail independently:
 *
 *   - past a threshold the round trip is rejected outright,
 *     so there is no PnL at all rather than a bad one
 *   - below it the trade is accepted and books a positive
 *     headline profit that is still not realizable
 * ========================================================== */

const capacityRows = runCapacityAttackSweep();

console.log("\n=== CAPACITY UTILIZATION ===");

console.table(
  capacityRows.map((row) => ({
    utilization: `${(row.utilization * 100).toFixed(0)}%`,
    size: row.attackerSize,
    margin: row.attackerMargin,
    entry:
      row.entryPrice === null
        ? "--"
        : row.entryPrice.toFixed(3),
    exit:
      row.exitPrice === null
        ? "--"
        : row.exitPrice.toFixed(3),
    headlinePnl:
      row.headlinePnl === null
        ? "--"
        : row.headlinePnl.toFixed(0),
    liqOnEntry:
      row.liquidatedOnEntry === null
        ? "--"
        : row.liquidatedOnEntry,
    realizablePnl:
      row.realizablePnl === null
        ? "--"
        : row.realizablePnl.toFixed(0),
    status: row.entryError
      ? `entry rejected: ${row.entryError}`
      : row.exitError
        ? `exit rejected: ${row.exitError}`
        : "executable",
  })),
);

const rejected = capacityRows.filter(
  (row) => row.entryError ?? row.exitError,
);

const executable = capacityRows.filter(
  (row) => !row.entryError && !row.exitError,
);

console.log(
  `\nExecutable round trips: ${executable.length} of ` +
    `${capacityRows.length}`,
);

console.log(
  "Rejected round trips:",
  rejected.length,
  rejected.length > 0
    ? `(first at ${(rejected[0]!.utilization * 100).toFixed(0)}% utilization, ` +
      `${rejected[0]!.entryError ? "entry" : "exit"} leg)`
    : "",
);

console.log(
  "Executable round trips with a positive headline PnL:",
  executable.filter((row) => (row.headlinePnl ?? 0) > 0)
    .length,
  "of",
  executable.length,
);

console.log(
  "Executable round trips with a realizable PnL:",
  executable.filter(
    (row) => row.realizablePnl !== null,
  ).length,
  "of",
  executable.length,
);