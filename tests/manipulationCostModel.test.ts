import { describe, expect, it } from "vitest";
import { manipulationAttackCost } from "../experiments/manipulationCostModel.js";

describe("constant-product manipulation cost proxy", () => {
  it("reproduces the TWAP95, 900-second repeated slippage proxy", () => {
    const cost = manipulationAttackCost(95, 900);

    expect(cost.costPerBlock).toBeCloseTo(3_288.932830252219, 8);
    expect(cost.manipulatedBlocks).toBe(60);
    expect(cost.totalAttackCost).toBeCloseTo(197_335.96981513314, 8);
  });

  it("scales the one-shot score linearly with modeled duration", () => {
    const short = manipulationAttackCost(95, 300);
    const long = manipulationAttackCost(95, 900);

    expect(long.totalAttackCost).toBeCloseTo(
      short.totalAttackCost * 3,
      8,
    );
  });
});
