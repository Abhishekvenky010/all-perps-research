import {
  runCapacityAttackSweep,
  manipulationAttackCost,
  requiredSpotForTwap,
  INITIAL_SPOT_PRICE,
  BLOCK,
} from "./attackEconomicsModel.js";

import type { CapacityAttackRow } from "./attackEconomicsModel.js";

/*
 * ============================================================
 * ECONOMIC SECURITY SWEEP
 * ============================================================
 *
 * A three-dimensional matrix over the attack surface:
 *
 *   target TWAP  x  manipulation duration  x  attacker size
 *
 * The question is the All Perps requirement,
 *
 *   cost of producing the manipulation > extraction available
 *
 * measured as the global minimum of
 *
 *   costToExtraction = attackCost / headlineExtraction
 *
 * Two structural facts about the dimensions, and they are the
 * reason this is not simply a bigger table:
 *
 * 1. Extraction depends on the target TWAP and the attacker's
 *    size, but NOT on the manipulation duration. The attacker
 *    enters at the depressed mark and exits at the honest
 *    price; how long the TWAP was held beforehand changes the
 *    cost of moving the pool, not the fill they get.
 *
 * 2. Attack cost depends on the required spot and the
 *    duration, but NOT on the attacker's size. The cost is
 *    paid for moving the pool price, and the pool is the same
 *    pool whoever is trading against it.
 *
 * So the duration axis shifts cost while holding extraction
 * fixed, and the utilization axis shifts extraction while
 * holding cost fixed. The minimum of the ratio is therefore a
 * genuine two-way interaction, not the worst value of either
 * axis alone.
 *
 * Attacker utilization stops at 50% because the round trip
 * cannot be closed above roughly 55.6%: closing a long of size
 * S with a short of size S leaves 2S of open interest.
 */

const TARGET_TWAPS = [
  95, 90, 80, 70, 60, 50, 40,
] as const;

const ATTACK_DURATIONS = [
  15, 30, 60, 120, 300, 600, 900,
] as const;

const ATTACKER_UTILIZATIONS = [
  0.10, 0.20, 0.30, 0.40, 0.45, 0.49, 0.50,
] as const;

/**
 * The state space of an attack, most severe first.
 *
 * UNREACHABLE     the arithmetic TWAP inversion asks for a
 *                 price that cannot exist, so there is no
 *                 attack to price at all
 * NON_CLOSEABLE   the attacker got a fill but the current close
 *                 mechanism cannot complete the round trip
 * LIQUIDATED      the attack reached the perp and the margin
 *                 system prevented realization
 * SURVIVES        the attack completed and was not liquidated
 */
type Status =
  | "UNREACHABLE"
  | "NON_CLOSEABLE"
  | "LIQUIDATED"
  | "SURVIVES";

interface SecurityRow {
  targetTwap: number;
  duration: number;
  utilization: string;
  attackerSize: number;
  requiredSpot: number;
  headlineExtraction: number;
  realizablePnl: number;
  attackCost: number;
  costToExtraction: number;
  liquidatedOnEntry: boolean;
  status: Status;
}

/*
 * Extraction does not depend on duration, so the capacity
 * sweeps are built once per target and reused across the seven
 * durations rather than rebuilt 49 times.
 */
const sweeps = new Map<number, CapacityAttackRow[]>();

function capacitySweep(
  targetTwap: number,
): CapacityAttackRow[] {
  const cached = sweeps.get(targetTwap);

  if (cached) {
    return cached;
  }

  const built = runCapacityAttackSweep(
    ATTACKER_UTILIZATIONS,
    targetTwap,
  );

  sweeps.set(targetTwap, built);

  return built;
}

const rows: SecurityRow[] = [];

for (const targetTwap of TARGET_TWAPS) {
  for (const duration of ATTACK_DURATIONS) {
    /*
     * The cost is keyed on the spot the pool has to be dragged
     * to, not on the target TWAP. At a full-window manipulation
     * the two coincide, which is exactly why using the TWAP
     * directly looks correct and is not: for a 15 second
     * manipulation the same TWAP target requires a far deeper
     * and far more expensive spot, or no spot at all.
     */
    const requiredSpot = requiredSpotForTwap(
      targetTwap,
      duration,
    );

    /*
     * A TWAP is an average, so a deep target held briefly needs
     * a price at or below zero. That is not an expensive
     * attack, it is not an attack, and it must not be recorded
     * as one that failed to profit.
     */
    const unreachable =
      !Number.isFinite(requiredSpot) ||
      requiredSpot <= 0 ||
      requiredSpot >= INITIAL_SPOT_PRICE;

    const attackCost = unreachable
      ? NaN
      : manipulationAttackCost(
          requiredSpot,
          duration,
        ).totalAttackCost;

    const sweep = capacitySweep(targetTwap);

    for (const utilization of ATTACKER_UTILIZATIONS) {
      const utilizationPercent = `${Math.round(
        utilization * 100,
      )}%`;

      // utilization is a number on the row, not a string.
      const capacityRow = sweep.find(
        (candidate) =>
          candidate.utilization === utilization,
      );

      if (!capacityRow) {
        continue;
      }

      if (unreachable) {
        rows.push({
          targetTwap,
          duration,
          utilization: utilizationPercent,
          attackerSize: capacityRow.attackerSize,
          requiredSpot,
          headlineExtraction: NaN,
          realizablePnl: NaN,
          attackCost: NaN,
          costToExtraction: NaN,
          liquidatedOnEntry: false,
          status: "UNREACHABLE",
        });

        continue;
      }

      /*
       * Classification. Order matters: a round trip that could
       * not be closed never got far enough to be liquidated, so
       * the close failure is reported first.
       */
      const status: Status =
        capacityRow.entryError ||
        capacityRow.exitError
          ? "NON_CLOSEABLE"
          : capacityRow.liquidatedOnEntry
            ? "LIQUIDATED"
            : "SURVIVES";

      /*
       * headlinePnl is null when the round trip did not
       * complete. Number(null) is 0, which would read as a
       * completed trade that merely made no money, so null is
       * checked directly.
       */
      const headlineExtraction =
        capacityRow.headlinePnl ?? NaN;

      const realizablePnl =
        capacityRow.realizablePnl ?? NaN;

      const measurable =
        Number.isFinite(headlineExtraction) &&
        headlineExtraction > 0;

      rows.push({
        targetTwap,
        duration,
        utilization: utilizationPercent,
        attackerSize: capacityRow.attackerSize,
        requiredSpot,
        headlineExtraction,
        realizablePnl,
        attackCost,
        costToExtraction: measurable
          ? attackCost / headlineExtraction
          : NaN,
        liquidatedOnEntry:
          capacityRow.liquidatedOnEntry ?? false,
        status,
      });
    }
  }
}

/* ============================================================
 * ANALYSIS
 * ========================================================== */

/**
 * Executable means the round trip actually closed, so the
 * extraction is a real fill pair rather than an absence.
 */
const executable = rows.filter(
  (row) =>
    row.status === "LIQUIDATED" ||
    row.status === "SURVIVES",
);

/**
 * Measurable means there is a positive extraction to compare a
 * cost against. A completed round trip that made no money is
 * not a threat and does not belong in a ratio.
 */
const measurable = executable.filter(
  (row) =>
    Number.isFinite(row.headlineExtraction) &&
    row.headlineExtraction > 0 &&
    Number.isFinite(row.costToExtraction),
);

function byLowestCostToExtraction(
  a: SecurityRow,
  b: SecurityRow,
): number {
  return a.costToExtraction - b.costToExtraction;
}

function byHighestExtraction(
  a: SecurityRow,
  b: SecurityRow,
): number {
  return b.headlineExtraction - a.headlineExtraction;
}

function byHighestAttackCost(
  a: SecurityRow,
  b: SecurityRow,
): number {
  return b.attackCost - a.attackCost;
}

function lowest(list: SecurityRow[]): SecurityRow | null {
  if (list.length === 0) {
    return null;
  }

  return [...list].sort(byLowestCostToExtraction)[0]!;
}

function highest(
  list: SecurityRow[],
  compare: (
    a: SecurityRow,
    b: SecurityRow,
  ) => number,
): SecurityRow | null {
  if (list.length === 0) {
    return null;
  }

  return [...list].sort(compare)[0]!;
}

function tally(list: SecurityRow[]): Record<Status, number> {
  return {
    UNREACHABLE: list.filter(
      (row) => row.status === "UNREACHABLE",
    ).length,
    NON_CLOSEABLE: list.filter(
      (row) => row.status === "NON_CLOSEABLE",
    ).length,
    LIQUIDATED: list.filter(
      (row) => row.status === "LIQUIDATED",
    ).length,
    SURVIVES: list.filter(
      (row) => row.status === "SURVIVES",
    ).length,
  };
}

function show(row: SecurityRow | null): unknown {
  if (!row) {
    return "none";
  }

  return {
    targetTwap: row.targetTwap,
    duration: row.duration,
    utilization: row.utilization,
    attackerSize: row.attackerSize,
    requiredSpot: Number(row.requiredSpot.toFixed(2)),
    headlineExtraction: Number(
      row.headlineExtraction.toFixed(0),
    ),
    realizablePnl: Number(row.realizablePnl.toFixed(0)),
    attackCost: Number(row.attackCost.toFixed(0)),
    costToExtraction: Number(
      row.costToExtraction.toFixed(3),
    ),
    status: row.status,
  };
}

const worstCase = lowest(measurable);
const maximumExtraction = highest(
  measurable,
  byHighestExtraction,
);
const minimumAttackCost = highest(
  measurable,
  (a, b) => a.attackCost - b.attackCost,
);

const invariantViolations = measurable.filter(
  (row) => row.attackCost <= row.headlineExtraction,
);

console.log(
  "\n========== ECONOMIC SECURITY SWEEP ==========\n",
);

console.log({
  totalMeasurements: rows.length,
  executableMeasurements: executable.length,
  measurableMeasurements: measurable.length,
  rejectedMeasurements:
    rows.length - executable.length,
});

console.log("\nState space:");

console.table(
  Object.entries(tally(rows)).map(
    ([status, count]) => ({ status, count }),
  ),
);

console.log("\nWorst economic case:");

console.table([show(worstCase)]);

console.log("\nMaximum headline extraction:");

console.table([show(maximumExtraction)]);

console.log("\nMinimum attack cost:");

console.table([show(minimumAttackCost)]);

console.log("\nCore invariant:");

console.log({
  worstCaseRatio: worstCase
    ? Number(worstCase.costToExtraction.toFixed(3))
    : null,
  attackCost: worstCase?.attackCost,
  extraction: worstCase?.headlineExtraction,
  scenario: worstCase
    ? `TWAP ${worstCase.targetTwap} over ${worstCase.duration}s at ${worstCase.utilization} utilization`
    : null,
  holds: worstCase
    ? worstCase.attackCost > worstCase.headlineExtraction
    : null,
});

console.log("\nInvariant violations:");

if (invariantViolations.length === 0) {
  console.log("NONE");
} else {
  console.table(invariantViolations.map(show));
}

console.log(
  "\n========== TOP 10 ATTACK OPPORTUNITIES ==========\n",
);

console.table(
  [...measurable].sort(byLowestCostToExtraction).slice(0, 10).map(show),
);

console.log(
  "\n========== TOP 10 EXTRACTION CASES ==========\n",
);

console.table(
  [...measurable].sort(byHighestExtraction).slice(0, 10).map(show),
);

console.log(
  "\n========== MOST EXPENSIVE ATTACKS ==========\n",
);

console.table(
  [...measurable].sort(byHighestAttackCost).slice(0, 10).map(show),
);

/*
 * The duration axis only moves cost, so within a target the
 * cheapest attack is always the longest manipulation. The
 * utilization axis only moves extraction, and extraction is
 * non-monotonic in size, so the most extractable attack is
 * neither the largest nor the smallest. Both facts are
 * reported rather than left for the reader to infer.
 */
console.log(
  "\n========== AXIS BEHAVIOUR ==========\n",
);

const cheapestDuration = highest(
  measurable,
  (a, b) => a.attackCost - b.attackCost,
);

const bestExtraction = highest(
  measurable,
  byHighestExtraction,
);

console.log({
  cheapestManipulation: cheapestDuration
    ? `TWAP ${cheapestDuration.targetTwap}, ${cheapestDuration.duration}s, ${cheapestDuration.utilization}`
    : null,
  bestExtraction: bestExtraction
    ? `TWAP ${bestExtraction.targetTwap}, ${bestExtraction.duration}s, ${bestExtraction.utilization}`
    : null,
  blockSeconds: BLOCK,
});

/*
 * Realized extraction across the whole matrix. If anything
 * survives the margin system, that is the number that matters,
 * not the headline column.
 */
const surviving = rows.filter(
  (row) => row.status === "SURVIVES",
);

console.log({
  scenariosReachingRealization: surviving.length,
  maximumRealizedExtraction:
    surviving.length > 0
      ? Math.max(
          ...surviving.map((row) => row.realizablePnl),
        )
      : 0,
});
