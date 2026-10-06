import {
  describe,
  expect,
  it,
} from "vitest";

import {
  runAttackSweep,
  runCapacityAttackSweep,
  manipulationAttackCost,
  requiredSpotForTwap,
  replayTwap,
  INITIAL_SPOT_PRICE,
  BLOCK,
  MAINTENANCE_MARGIN,
  config,
} from "../experiments/attackEconomicsModel.js";

import type { AttackRow } from "../experiments/attackEconomicsModel.js";
import type { CapacityAttackRow } from "../experiments/attackEconomicsModel.js";

/*
 * ============================================================
 * TWAP ATTACK ECONOMICS
 * ============================================================
 *
 * The All Perps security requirement is:
 *
 *     attack cost > attacker profit
 *
 * These tests assert that requirement directly against the
 * attack sweep rather than trusting a printed table.
 *
 * The tests also pin the structure of the attack-cost model,
 * so reverting from a sustained manipulation cost back to a
 * one-time cost fails here.
 */

const rows = runAttackSweep();

const reachable = rows.filter(
  (row) => row.reachable,
);

const profitable = reachable.filter(
  (row) => row.roundTripPnl > 0,
);

function at(
  targetTwap: number,
  duration: number,
): AttackRow {
  const row = reachable.find(
    (candidate) =>
      candidate.targetTwap === targetTwap &&
      candidate.duration === duration,
  );

  if (!row) {
    throw new Error(
      `no reachable attack for target ${targetTwap} over ${duration}s`,
    );
  }

  return row;
}

describe("TWAP attack economics", () => {
  it("produces reachable attacks", () => {
    expect(reachable.length).toBeGreaterThan(0);
    expect(profitable.length).toBeGreaterThan(0);
  });

  /*
   * The primary economic security requirement.
   *
   * Every reachable attack that shows positive perp extraction
   * must cost more to sustain than the attacker can extract.
   */
  it("costs more to sustain than any attack can extract", () => {
    for (const attack of profitable) {
      expect(attack.attackCost).toBeGreaterThan(
        attack.roundTripPnl,
      );
    }
  });

  /*
   * No reachable scenario should satisfy all conditions required
   * to become an economically realizable attack.
   */
  it("never leaves a realizable attack", () => {
    for (const attack of reachable) {
      expect(attack.realizable).toBe(false);
    }
  });

  /*
   * The closest reachable scenario must still remain above the
   * economic security boundary.
   */
  it("holds on the thinnest margin", () => {
    const thinnest = reachable.reduce((a, b) =>
      b.costToProfitRatio < a.costToProfitRatio
        ? b
        : a,
    );

    expect(thinnest.costToProfitRatio).toBeGreaterThan(1);
  });
});

describe("attack cost model", () => {
  /*
   * attackCost = costPerBlock * manipulatedBlocks.
   *
   * If someone accidentally reintroduces a one-time cost,
   * these assertions will fail.
   */
  it("is the sustained cost, not a one-time cost", () => {
    for (const attack of reachable) {
      expect(attack.manipulatedBlocks).toBe(
        attack.duration / BLOCK,
      );

      expect(attack.attackCost).toBeCloseTo(
        attack.manipulationCostPerBlock *
          attack.manipulatedBlocks,
        6,
      );

      /*
       * Any manipulation longer than one block must cost more
       * than the cost of sustaining it for one block.
       */
      if (attack.duration > BLOCK) {
        expect(attack.attackCost).toBeGreaterThan(
          attack.manipulationCostPerBlock,
        );

        expect(attack.manipulatedBlocks).toBeGreaterThan(
          1,
        );
      }
    }
  });

  /*
   * At a fixed manipulated spot, the per-block cost is constant.
   * Therefore total cost is linear in the duration.
   */
  it("costs more the longer the same depth is held", () => {
    const spot = 90;

    const at300 = manipulationAttackCost(
      spot,
      300,
    );

    const at600 = manipulationAttackCost(
      spot,
      600,
    );

    const at900 = manipulationAttackCost(
      spot,
      900,
    );

    expect(at300.manipulatedBlocks).toBe(20);
    expect(at600.manipulatedBlocks).toBe(40);
    expect(at900.manipulatedBlocks).toBe(60);

    expect(at300.totalAttackCost).toBeGreaterThan(0);

    expect(at600.totalAttackCost).toBeGreaterThan(
      at300.totalAttackCost,
    );

    expect(at900.totalAttackCost).toBeGreaterThan(
      at600.totalAttackCost,
    );

    /*
     * Doubling the duration doubles the cost because the
     * per-block manipulation cost is unchanged.
     */
    expect(at900.totalAttackCost).toBeCloseTo(
      at300.totalAttackCost * 3,
      6,
    );

    expect(at600.totalAttackCost).toBeCloseTo(
      at300.totalAttackCost * 2,
      6,
    );
  });

  /*
   * Deeper manipulation costs more per block.
   *
   * The constant-product model makes deeper price movements
   * progressively more expensive.
   */
  it("costs more the deeper the manipulation goes", () => {
    const duration = 900;

    const at40 = at(40, duration);
    const at50 = at(50, duration);
    const at60 = at(60, duration);
    const at70 = at(70, duration);

    expect(at40.attackCost).toBeGreaterThan(
      at50.attackCost,
    );

    expect(at50.attackCost).toBeGreaterThan(
      at60.attackCost,
    );

    expect(at60.attackCost).toBeGreaterThan(
      at70.attackCost,
    );
  });

  /*
   * Important distinction:
   *
   * For a fixed target TWAP, longer manipulation can be cheaper.
   *
   * A TWAP is an average. Holding the price depressed for fewer
   * blocks requires a much deeper spot manipulation to produce
   * the same average.
   *
   * Therefore:
   *
   *     fixed target TWAP
   *     shorter duration
   *         -> deeper required spot
   *         -> much higher per-block cost
   *
   * The current model therefore predicts:
   *
   *     120s > 300s > 600s > 900s
   *
   * for the total attack cost targeting TWAP 90.
   */
  it("costs less for a longer manipulation of a fixed target", () => {
    const at120 = at(90, 120);
    const at300 = at(90, 300);
    const at600 = at(90, 600);
    const at900 = at(90, 900);

    expect(at120.attackCost).toBeGreaterThan(
      at300.attackCost,
    );

    expect(at300.attackCost).toBeGreaterThan(
      at600.attackCost,
    );

    expect(at600.attackCost).toBeGreaterThan(
      at900.attackCost,
    );
  });
});

describe("TWAP oracle integration", () => {
  /*
   * The sweep asks for a target TWAP and derives the required
   * manipulated spot. The production oracle must reproduce that
   * target.
   */
  it("reproduces every requested target", () => {
    for (const attack of reachable) {
      expect(
        Math.abs(attack.oracleError),
      ).toBeLessThanOrEqual(0.01);
    }
  });

  /*
   * Self-flow cannot improve the attacker's ability to produce
   * the desired depressed TWAP.
   *
   * The attacker's own skew pushes the price further in the same
   * direction, so the resulting TWAP cannot be higher than the
   * exogenous manipulation alone.
   */
  it("is never helped by the attacker's own flow", () => {
    for (const attack of reachable) {
      const exogenous = replayTwap(
        attack.requiredSpot,
        attack.duration,
        false,
      );

      const withSelfFlow = replayTwap(
        attack.requiredSpot,
        attack.duration,
        true,
      );

      expect(withSelfFlow).toBeLessThanOrEqual(
        exogenous + 1e-9,
      );
    }
  });

  /*
   * A TWAP is an average.
   *
   * Deep targets over short windows may require a negative spot,
   * which is not a tradeable state.
   */
  it("cannot reach a deep target over a short window", () => {
    expect(
      requiredSpotForTwap(40, 60),
    ).toBeLessThan(0);

    expect(
      requiredSpotForTwap(90, 900),
    ).toBeCloseTo(90, 6);

    const unreachable = rows.filter(
      (row) => !row.reachable,
    );

    expect(unreachable.length).toBeGreaterThan(
      reachable.length,
    );
  });

  /*
   * Verify the actual capacity relationship rather than relying
   * on the current number of scenarios.
   */
  it("self-flow feasibility matches capacity usage", () => {
    for (const attack of reachable) {
      expect(
        attack.selfFlowUsagePct,
      ).not.toBeNull();

      expect(attack.selfFlowFeasible).toBe(
        attack.selfFlowUsagePct! < 100,
      );
    }
  });
});

describe("liquidation", () => {
  /*
   * The attacker buys through the execution spread.
   *
   * Therefore the entry fill is above the depressed TWAP mark.
   * With the current margin configuration, every reachable
   * attack is liquidatable at the manipulated mark.
   */
  it("liquidates the attacker on entry", () => {
    for (const attack of reachable) {
      expect(
        attack.liquidatedOnEntry,
      ).toBe(true);

      expect(
        attack.marginRatioAtManipulatedMark,
      ).toBeLessThan(MAINTENANCE_MARGIN);

      expect(
        attack.marginRatioAtManipulatedMark,
      ).toBeLessThan(0);
    }
  });

  /*
   * The headline round-trip PnL can be positive, but the attack
   * is not realizable under the modeled execution and liquidation
   * constraints.
   */
  it("shows positive headline PnL that is never realizable", () => {
    for (const attack of reachable) {
      expect(
        attack.naivePnlPositive,
      ).toBe(true);

      expect(
        attack.realizable,
      ).toBe(false);
    }
  });
});
describe("capacity utilization", () => {
  const capacity = runCapacityAttackSweep();

  const executable = capacity.filter(
    (row) => !row.entryError && !row.exitError,
  );

  const rejected = capacity.filter(
    (row) => row.entryError ?? row.exitError,
  );

  const at = (
    utilization: number,
  ): CapacityAttackRow => {
    const row = capacity.find(
      (candidate) =>
        candidate.utilization === utilization,
    );

    if (!row) {
      throw new Error(
        `no capacity row at ${utilization}`,
      );
    }

    return row;
  };

  it("separates executable from rejected round trips", () => {
    expect(executable.length).toBeGreaterThan(0);
    expect(rejected.length).toBeGreaterThan(0);
  });

  /*
   * A rejected round trip reports no PnL at all, rather than a
   * worse one. There is no completed trade to value.
   *
   * A known entry fill is not a contradiction: the fill really
   * happened and its price is real. What cannot exist is a
   * realized profit, because there is no exit and no position
   * that survived to be closed.
   */
  it("reports nothing rather than a loss when rejected", () => {
    for (const row of rejected) {
      expect(row.exitPrice).toBeNull();
      expect(row.headlinePnl).toBeNull();
      expect(row.realizablePnl).toBeNull();
    }
  });

  /*
   * The rejection is on the exit, not the entry.
   *
   * simulateTrade checks capacity per step against the state it
   * has already built, so an entry of size S always fits on its
   * own. The exit is what fails: closing a long of size S with
   * a short of size S leaves 2S of open interest, because the
   * two legs do not offset each other, and 2S eventually
   * exceeds maxCapacity.
   *
   * This is the distinction that matters. The attacker is not
   * blocked from opening; they are blocked from closing, which
   * is strictly worse, because the position is then stuck open
   * and drifting while the price recovers.
   */
  it("rejects on exit while the entry still succeeds", () => {
    for (const row of rejected) {
      expect(row.entryError).toBeUndefined();
      expect(row.exitError).toBe(
        "MARKET_CAPACITY_EXCEEDED",
      );

      /*
       * The entry filled, so its price is known even though
       * the round trip never completed.
       */
      expect(row.entryPrice).not.toBeNull();
      expect(row.exitPrice).toBeNull();
    }
  });

  /*
   * The boundary sits between 50% and 60% utilization rather
   * than exactly at 50%, because the last step is priced before
   * its own exposure is applied. With five steps the exit needs
   * 2S - S/5 to fit, putting the true boundary near 55.6%.
   */
  it("pins the round-trip capacity boundary", () => {
    expect(at(0.5).exitError).toBeUndefined();
    expect(at(0.49).exitError).toBeUndefined();
    expect(at(0.6).exitError).toBe(
      "MARKET_CAPACITY_EXCEEDED",
    );
  });

  /*
   * Every accepted entry is immediately liquidatable, at every
   * size. Scaling the attack up does not make the position
   * holdable.
   */
  it("liquidates every accepted entry at every size", () => {
    for (const row of executable) {
      expect(row.liquidatedOnEntry).toBe(true);
    }
  });

  it("never leaves a realizable PnL at any size", () => {
    for (const row of capacity) {
      expect(row.realizablePnl).toBeNull();
    }
  });

  /*
   * The headline profit is non-monotonic in size. It rises,
   * peaks near 40% utilization, then collapses as the
   * attacker's own open interest widens the spread against
   * them. Scaling the attack does not scale the extraction; it
   * destroys it.
   */
  it("peaks below full capacity and collapses toward it", () => {
    const pnlAt = (utilization: number): number =>
      at(utilization).headlinePnl ?? 0;

    expect(pnlAt(0.3)).toBeGreaterThan(pnlAt(0.2));
    expect(pnlAt(0.4)).toBeGreaterThan(pnlAt(0.3));

    expect(pnlAt(0.5)).toBeLessThan(pnlAt(0.4));
    expect(pnlAt(0.49)).toBeLessThan(pnlAt(0.45));
  });

  it("holds leverage constant across the capacity axis", () => {
    for (const row of capacity) {
      expect(
        row.attackerSize / row.attackerMargin,
      ).toBeCloseTo(5, 10);
    }

    expect(config.maxCapacity).toBe(100_000);
  });
});
