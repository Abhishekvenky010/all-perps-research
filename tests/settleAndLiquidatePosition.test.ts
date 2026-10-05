import { describe, it, expect } from "vitest";

import {
  settleAndLiquidatePosition,
} from "../src/settlement/SettleAndLiquidatePosition.js";

import {
  createLiquidityVault,
} from "../src/liquidity/LiquidityVault.js";

import {
  PositionManager,
} from "../src/position/PositionManager.js";

describe("Settle and liquidate position", () => {
  it("settles a liquidated LONG loss and closes it", () => {
    const vault = createLiquidityVault(50_000);

    const market = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 100,
      shortOpenInterest: 0,
    };

    const positionManager = new PositionManager();

    const position = {
      id: "liquidation-1",
      trader: "Alice",
      market: "BTC-PERP",
      side: "LONG" as const,
      size: 100,
      entryPrice: 100,
      margin: 1_000,
    };

    positionManager.openPosition(position);

    const result = settleAndLiquidatePosition(
      position.id,
      90,
      market,
      positionManager,
      vault,
      0.05,
    );

    expect(result.pnl).toBe(-1_000);
    expect(result.realizedPnL).toBe(-1_000);
    expect(result.remainingMargin).toBe(0);
    expect(result.traderSettlement).toBe(0);
    expect(result.closed).toBe(true);

    expect(vault.traderPnL).toBe(-1_000);
    expect(vault.availableCapital).toBe(51_000);

    expect(market.longOpenInterest).toBe(0);

    expect(
      positionManager.getPosition(position.id),
    ).toBeUndefined();
  });

  it("preserves remaining margin after liquidation", () => {
    const vault = createLiquidityVault(50_000);

    const market = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 100,
      shortOpenInterest: 0,
    };

    const positionManager = new PositionManager();

    const position = {
      id: "liquidation-2",
      trader: "Alice",
      market: "BTC-PERP",
      side: "LONG" as const,
      size: 100,
      entryPrice: 100,
      margin: 1_000,
    };

    positionManager.openPosition(position);

    const result = settleAndLiquidatePosition(
      position.id,
      90.4,
      market,
      positionManager,
      vault,
      0.5,
    );

    expect(result.pnl).toBeCloseTo(-960);
    expect(result.remainingMargin).toBeCloseTo(40);
    expect(result.traderSettlement).toBeCloseTo(40);

    expect(vault.traderPnL).toBeCloseTo(-960);
    expect(vault.availableCapital).toBeCloseTo(50_960);

    expect(market.longOpenInterest).toBe(0);

    expect(
      positionManager.getPosition(position.id),
    ).toBeUndefined();
  });

  it("does not mutate state when the position is healthy", () => {
    const vault = createLiquidityVault(50_000);

    const market = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 100,
      shortOpenInterest: 0,
    };

    const positionManager = new PositionManager();

    const position = {
      id: "healthy-1",
      trader: "Alice",
      market: "BTC-PERP",
      side: "LONG" as const,
      size: 100,
      entryPrice: 100,
      margin: 1_000,
    };

    positionManager.openPosition(position);

    expect(() =>
      settleAndLiquidatePosition(
        position.id,
        99,
        market,
        positionManager,
        vault,
        0.05,
      ),
    ).toThrow("POSITION_HEALTHY");

    expect(vault.traderPnL).toBe(0);
    expect(vault.availableCapital).toBe(50_000);

    expect(market.longOpenInterest).toBe(100);

    expect(
      positionManager.getPosition(position.id),
    ).toBeDefined();
  });
});