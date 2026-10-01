import { describe, expect, it } from "vitest";

import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";

import { PositionManager } from "../src/position/PositionManager.js";
import { runLiquidationSweep } from "../src/risk/LiquidationSweep.js";
import { markPosition } from "../src/risk/PositionMark.js";
import { liquidatePosition } from "../src/risk/LiquidationEngine.js";
import { getCurrentAmmPrice } from "../src/amm/Pricing.js";
import { canIncreaseExposure } from "../src/amm/Capacity.js";

const config: MarketConfig = {
  symbol: "BTC-PERP",
  maxCapacity: 100_000,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 20,
  maintenanceMargin: 0.05,
};

function createState(
  longOpenInterest: number,
  shortOpenInterest: number,
): MarketState {
  return {
    symbol: "BTC-PERP",
    indexPrice: 100,
    ammTwapPrice: 100,
    longOpenInterest,
    shortOpenInterest,
  };
}

describe("AMM price -> PnL -> margin -> liquidation -> OI -> capacity", () => {
  it("marks a position from the AMM price", () => {
    const position = {
      id: "p1",
      trader: "Alice",
      market: "BTC-PERP",
      side: "LONG" as const,
      size: 100,
      entryPrice: 100,
      margin: 50,
    };

    // A long-heavy market pushes the AMM price above entry.
    const state = createState(40_000, 10_000);

    const markPrice = getCurrentAmmPrice(state, config);

    const mark = markPosition(
      position,
      markPrice,
      0.05,
    );

    expect(markPrice).toBeGreaterThan(100);

    expect(mark.pnl).toBeCloseTo(
      (markPrice - 100) * 100,
      10,
    );

    expect(mark.equity).toBeCloseTo(
      50 + mark.pnl,
      10,
    );

    expect(mark.liquidatable).toBe(false);
  });

  it("liquidates an underwater long when the AMM price falls", () => {
    // Short-heavy market: the AMM price trades below the TWAP.
    const state = createState(10_000, 60_000);

    const manager = new PositionManager();

    const position = {
      id: "p-underwater",
      trader: "Bob",
      market: "BTC-PERP",
      side: "LONG" as const,
      size: 10_000,
      entryPrice: 100,
      margin: 100,
    };

    manager.openPosition(position);

    const markPrice = getCurrentAmmPrice(state, config);

    expect(markPrice).toBeLessThan(100);

    // Equity 100 - large loss drops the margin ratio below 0.05.
    const result = liquidatePosition(
      position,
      markPrice,
      state,
      manager,
      0.05,
    );

    expect(result.closed).toBe(true);
    expect(result.marginRatio).toBeLessThan(0.05);
    expect(result.releasedOpenInterest).toBe(10_000);
    expect(manager.getPosition("p-underwater")).toBeUndefined();
  });

  it("recovers capacity after a sweep liquidates a crowded book", () => {
    // The TWAP crashes, so longs entered at 110 are underwater
    // even though long skew is still pushing the mark up.
    const state = createState(90_000, 10_000);
    state.ammTwapPrice = 90;

    const manager = new PositionManager();

    // Thin margin and a high entry: liquidatable.
    const fragile = {
      id: "p-fragile",
      trader: "Carol",
      market: "BTC-PERP",
      side: "LONG" as const,
      size: 20_000,
      entryPrice: 110,
      margin: 200,
    };

    // Entered low with a large margin: survives.
    const healthy = {
      id: "p-healthy",
      trader: "Dave",
      market: "BTC-PERP",
      side: "LONG" as const,
      size: 20_000,
      entryPrice: 100,
      margin: 50_000,
    };

    manager.openPosition(fragile);
    manager.openPosition(healthy);

    const result = runLiquidationSweep(
      state,
      config,
      manager,
    );

    // The fragile long is liquidated.
    expect(result.liquidations).toHaveLength(1);
    expect(
      result.liquidations[0]?.positionId,
    ).toBe("p-fragile");

    // Its open interest is released.
    expect(result.releasedOpenInterest).toBe(20_000);
    expect(state.longOpenInterest).toBe(70_000);

    // Capacity is recovered, not just re-labelled.
    expect(
      result.recoveredCapacity,
    ).toBeCloseTo(20_000, 10);
    expect(
      result.capacityAfter.remainingCapacity,
    ).toBeCloseTo(
      result.capacityBefore.remainingCapacity +
        20_000,
      10,
    );

    // Capacity usage drops below the limit.
    expect(
      result.capacityBefore.capacityUsage,
    ).toBeCloseTo(1, 10);
    expect(
      result.capacityAfter.capacityUsage,
    ).toBeCloseTo(0.8, 10);

    // The healthy position survives.
    expect(
      manager.getPosition("p-healthy"),
    ).toBeDefined();
    expect(result.healthAfter).toBe(1);
  });

  it("lets a new trade use the recovered capacity", () => {
    const state = createState(90_000, 10_000);
    state.ammTwapPrice = 90;

    const manager = new PositionManager();

    manager.openPosition({
      id: "p-fragile",
      trader: "Carol",
      market: "BTC-PERP",
      side: "LONG",
      size: 20_000,
      entryPrice: 110,
      margin: 200,
    });

    // Before the sweep the market is full.
    expect(
      canIncreaseExposure(state, config, 1),
    ).toBe(false);

    runLiquidationSweep(state, config, manager);

    // After the sweep there is room again.
    expect(
      canIncreaseExposure(state, config, 20_000),
    ).toBe(true);
  });

  it("pushes the AMM price back toward the TWAP as skew unwinds", () => {
    const state = createState(90_000, 10_000);
    state.ammTwapPrice = 90;

    const manager = new PositionManager();

    manager.openPosition({
      id: "p-fragile",
      trader: "Carol",
      market: "BTC-PERP",
      side: "LONG",
      size: 20_000,
      entryPrice: 110,
      margin: 200,
    });

    const skewedPrice = getCurrentAmmPrice(
      state,
      config,
    );

    const result = runLiquidationSweep(
      state,
      config,
      manager,
    );

    // Releasing the long reduces skew, so the mark falls back
    // toward the crashed 90 TWAP.
    expect(skewedPrice).toBeGreaterThan(90);
    expect(result.capacityAfter.markPrice).toBeLessThan(
      skewedPrice,
    );
    expect(
      result.capacityAfter.markPrice,
    ).toBeGreaterThan(90);
  });

  it("is a no-op on a balanced, healthy book", () => {
    const state = createState(30_000, 30_000);

    const manager = new PositionManager();

    manager.openPosition({
      id: "p1",
      trader: "Erin",
      market: "BTC-PERP",
      side: "LONG",
      size: 10_000,
      entryPrice: 100,
      margin: 5_000,
    });

    const result = runLiquidationSweep(
      state,
      config,
      manager,
    );

    expect(result.liquidations).toHaveLength(0);
    expect(result.releasedOpenInterest).toBe(0);
    expect(result.recoveredCapacity).toBe(0);
    expect(
      result.capacityBefore.remainingCapacity,
    ).toBe(
      result.capacityAfter.remainingCapacity,
    );
  });

  it("ignores positions from other markets", () => {
    const state = createState(90_000, 10_000);

    const manager = new PositionManager();

    manager.openPosition({
      id: "p-other",
      trader: "Frank",
      market: "ETH-PERP",
      side: "LONG",
      size: 5_000,
      entryPrice: 100,
      margin: 50,
    });

    const result = runLiquidationSweep(
      state,
      config,
      manager,
    );

    expect(result.liquidations).toHaveLength(0);
    expect(
      manager.getPosition("p-other"),
    ).toBeDefined();
  });
});
