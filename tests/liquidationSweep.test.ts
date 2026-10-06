import { describe, expect, it } from "vitest";

import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";

import { PositionManager } from "../src/position/PositionManager.js";
import { runLiquidationSweep } from "../src/risk/LiquidationSweep.js";
import { markPosition } from "../src/risk/PositionMark.js";
import { liquidatePosition } from "../src/risk/LiquidationEngine.js";
import { getCurrentAmmPrice } from "../src/amm/Pricing.js";
import { canIncreaseExposure } from "../src/amm/Capacity.js";
import { createLiquidityVault } from "../src/liquidity/LiquidityVault.js";

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
    const state = createState(0, 0);

    const manager = new PositionManager();
    manager.openPosition({
      id: "p-backing-shorts",
      trader: "short-trader",
      market: "BTC-PERP",
      side: "SHORT",
      size: 60_000,
      entryPrice: 100,
      margin: 1_000_000,
    }, state);

    const position = {
      id: "p-underwater",
      trader: "Bob",
      market: "BTC-PERP",
      side: "LONG" as const,
      size: 10_000,
      entryPrice: 100,
      margin: 100,
    };

    manager.openPosition(position, state);

    const markPrice = getCurrentAmmPrice(state, config);

    expect(markPrice).toBeLessThan(100);

    // Equity 100 - large loss drops the margin ratio below 0.05.
    const result = liquidatePosition(
      position,
      state,
      config,
      manager,
      createLiquidityVault(100_000),
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
    const state = createState(0, 0);
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
      size: 70_000,
      entryPrice: 100,
      margin: 50_000,
    };

    manager.openPosition(fragile, state);
    manager.openPosition(healthy, state);
    manager.openPosition({
      id: "p-backing-shorts",
      trader: "short-trader",
      market: "BTC-PERP",
      side: "SHORT",
      size: 10_000,
      entryPrice: 100,
      margin: 1_000_000,
    }, state);

    const result = runLiquidationSweep(
      state,
      config,
      manager,
      createLiquidityVault(100_000),
    );

    // Both longs are underwater at their own-exposure-excluded marks.
    expect(result.liquidations).toHaveLength(2);
    expect(
      result.liquidations[0]?.positionId,
    ).toBe("p-fragile");
    expect(
      result.liquidations[1]?.positionId,
    ).toBe("p-healthy");

    // Their open interest is released.
    expect(result.releasedOpenInterest).toBe(90_000);
    expect(state.longOpenInterest).toBe(0);

    // Capacity is recovered, not just re-labelled.
    expect(
      result.recoveredCapacity,
    ).toBeCloseTo(90_000, 10);
    expect(
      result.capacityAfter.remainingCapacity,
    ).toBeCloseTo(
      result.capacityBefore.remainingCapacity +
        90_000,
      10,
    );

    // Capacity usage drops below the limit.
    expect(
      result.capacityBefore.capacityUsage,
    ).toBeCloseTo(1, 10);
    expect(
      result.capacityAfter.capacityUsage,
    ).toBeCloseTo(0.1, 10);

    // No long positions survive the counterfactual marks.
    expect(
      manager.getPosition("p-healthy"),
    ).toBeUndefined();
    expect(result.healthAfter).toBe(1);
  });

  it("lets a new trade use the recovered capacity", () => {
    const state = createState(0, 0);
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
    }, state);
    manager.openPosition({
      id: "p-backing-longs",
      trader: "long-trader",
      market: "BTC-PERP",
      side: "LONG",
      size: 70_000,
      entryPrice: 100,
      margin: 1_000_000,
    }, state);
    manager.openPosition({
      id: "p-backing-shorts",
      trader: "short-trader",
      market: "BTC-PERP",
      side: "SHORT",
      size: 10_000,
      entryPrice: 100,
      margin: 1_000_000,
    }, state);

    // Before the sweep the market is full.
    expect(
      canIncreaseExposure(state, config, 1),
    ).toBe(false);

    runLiquidationSweep(
      state,
      config,
      manager,
      createLiquidityVault(100_000),
    );

    // After the sweep there is room again.
    expect(
      canIncreaseExposure(state, config, 20_000),
    ).toBe(true);
  });

  it("pushes the AMM price back toward the TWAP as skew unwinds", () => {
    const state = createState(0, 0);
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
    }, state);
    manager.openPosition({
      id: "p-backing-longs",
      trader: "long-trader",
      market: "BTC-PERP",
      side: "LONG",
      size: 70_000,
      entryPrice: 100,
      margin: 1_000_000,
    }, state);
    manager.openPosition({
      id: "p-backing-shorts",
      trader: "short-trader",
      market: "BTC-PERP",
      side: "SHORT",
      size: 10_000,
      entryPrice: 100,
      margin: 1_000_000,
    }, state);

    const skewedPrice = getCurrentAmmPrice(
      state,
      config,
    );

    const result = runLiquidationSweep(
      state,
      config,
      manager,
      createLiquidityVault(100_000),
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
    const state = createState(0, 0);

    const manager = new PositionManager();

    manager.openPosition({
      id: "p1",
      trader: "Erin",
      market: "BTC-PERP",
      side: "LONG",
      size: 10_000,
      entryPrice: 100,
      margin: 5_000,
    }, state);
    manager.openPosition({
      id: "p-backing-longs",
      trader: "long-trader",
      market: "BTC-PERP",
      side: "LONG",
      size: 30_000,
      entryPrice: 100,
      margin: 1_000_000,
    }, state);
    manager.openPosition({
      id: "p-backing-shorts",
      trader: "short-trader",
      market: "BTC-PERP",
      side: "SHORT",
      size: 30_000,
      entryPrice: 100,
      margin: 1_000_000,
    }, state);

    const result = runLiquidationSweep(
      state,
      config,
      manager,
      createLiquidityVault(100_000),
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
    const state = createState(0, 0);
    const otherMarket = {
      ...createState(0, 0),
      symbol: "ETH-PERP",
    };

    const manager = new PositionManager();

    manager.openPosition({
      id: "p-other",
      trader: "Frank",
      market: "ETH-PERP",
      side: "LONG",
      size: 5_000,
      entryPrice: 100,
      margin: 50,
    }, otherMarket);

    const result = runLiquidationSweep(
      state,
      config,
      manager,
      createLiquidityVault(100_000),
    );

    expect(result.liquidations).toHaveLength(0);
    expect(
      manager.getPosition("p-other"),
    ).toBeDefined();
  });
});
