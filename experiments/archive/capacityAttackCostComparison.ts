import {
  runCapacityAttackSweep,
  manipulationAttackCost,
  requiredSpotForTwap,
  CAPACITY_UTILIZATIONS,
} from "./attackEconomicsModel.js";

import type { CapacityAttackRow } from "./attackEconomicsModel.js";

const TARGET_TWAP = 90;
const ATTACK_DURATION = 900;

/*
 * The sweep signature is (utilizations, targetTwap), so the
 * target has to be passed as the second argument.
 */
const rows = runCapacityAttackSweep(
  CAPACITY_UTILIZATIONS,
  TARGET_TWAP,
);

/*
 * The manipulation cost is paid for moving the pool price, so
 * it is keyed on the spot the pool has to be dragged to, not on
 * the target TWAP directly.
 *
 * At a full-window manipulation the two happen to coincide
 * (requiredSpotForTwap(t, 900) === t), but deriving it keeps
 * the cost correct if either the target or the duration moves.
 */
const REQUIRED_SPOT = requiredSpotForTwap(
  TARGET_TWAP,
  ATTACK_DURATION,
);

const attackCost = manipulationAttackCost(
  REQUIRED_SPOT,
  ATTACK_DURATION,
).totalAttackCost;

/*
 * Only completed round trips carry a headline PnL.
 *
 * Rejected rows hold headlinePnl as null, and null must not be
 * coerced: Number(null) is 0, so a rejected trade would pass a
 * numeric filter and then be read as an extraction of zero,
 * quietly dragging the worst-case extraction toward the floor.
 */
const executable = rows.filter(
  (row): row is CapacityAttackRow & {
    entryPrice: number;
    exitPrice: number;
    headlinePnl: number;
  } =>
    !row.entryError &&
    !row.exitError &&
    row.headlinePnl !== null,
);

const rejected = rows.filter(
  (row) => row.entryError ?? row.exitError,
);

/*
 * The manipulation cost does not depend on the size of the
 * attacker's position, only on the depth and duration of the
 * manipulation. So one fixed cost is being compared against
 * every row, and the binding case is whichever row extracts
 * the most, not whichever row happens to come first.
 */
const worstCase = executable.reduce(
  (worst, row) =>
    row.headlinePnl > (worst?.headlinePnl ?? -Infinity)
      ? row
      : worst,
  executable[0],
);

const maxHeadlineExtraction =
  worstCase?.headlinePnl ?? 0;

console.table(
  executable.map((row) => ({
    utilization: `${(row.utilization * 100).toFixed(0)}%`,
    attackerSize: row.attackerSize,
    entryPrice:
      row.entryPrice?.toFixed(3) ?? "--",
    headlineExtraction:
      row.headlinePnl?.toFixed(0) ?? "--",
    realizablePnl:
      row.realizablePnl?.toFixed(0) ?? "--",
    attackCost: attackCost.toFixed(0),
    costToExtraction:
      attackCost / (row.headlinePnl ?? Infinity),
    coversWorstCase:
      attackCost >
      (worstCase?.headlinePnl ?? Infinity),
  })),
);

console.log(
  `\nExecutable round trips: ${executable.length} of ${rows.length}`,
);

console.log(
  "Rejected round trips:",
  rejected.length,
  rejected.length > 0
    ? `(from ${(
        (rejected[0]?.utilization ?? 0) * 100
      ).toFixed(0)}% utilization, exit leg ${
        rejected[0]?.exitError ?? rejected[0]?.entryError
      })`
    : "",
);

console.log("\nWorst case for the attacker:");

console.log({
  targetTwap: TARGET_TWAP,
  attackDuration: ATTACK_DURATION,
  requiredSpot: REQUIRED_SPOT,
  utilization: worstCase
    ? `${(worstCase.utilization * 100).toFixed(0)}%`
    : "n/a",
  attackerSize: worstCase?.attackerSize,
  headlineExtraction: maxHeadlineExtraction,
  realizablePnl: worstCase?.realizablePnl ?? null,
  liquidatedOnEntry: worstCase?.liquidatedOnEntry,
});

/*
 * The All Perps requirement is attack cost > attacker profit.
 *
 * The honest comparison is against the worst case, which is the
 * largest extraction any executable size produces. And because
 * every accepted entry is liquidated at the manipulated mark,
 * the profit that can actually be banked is null at every size,
 * so the invariant holds with room to spare.
 */
console.log("\nEconomic security check:");

console.log({
  attackCost,
  maximumHeadlineExtraction: maxHeadlineExtraction,
  worstCaseRatio:
    maxHeadlineExtraction > 0
      ? attackCost / maxHeadlineExtraction
      : Infinity,
  headlineInvariantHolds:
    maxHeadlineExtraction > 0 &&
    attackCost > maxHeadlineExtraction,
  realizableExtraction:
    worstCase?.realizablePnl ?? null,
  realizableInvariantHolds:
    worstCase?.realizablePnl == null ||
    attackCost > worstCase.realizablePnl,
});