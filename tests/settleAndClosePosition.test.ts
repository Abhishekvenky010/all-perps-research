import { describe, it, expect } from "vitest";

import {
  settleAndClosePosition,
} from "../src/settlement/SettleAndClosePosition.js";

import {
  createLiquidityVault,
} from "../src/liquidity/LiquidityVault.js";

import {
  PositionManager,
} from "../src/position/PositionManager.js";

describe("Settle and close position", () => {
  it("settles a profitable LONG and closes it", () => {
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
      id: "position-1",
      trader: "Alice",
      market: "BTC-PERP",
      side: "LONG" as const,
      size: 100,
      entryPrice: 100,
      margin: 1_000,
    };

    positionManager.openPosition(position);

    const result = settleAndClosePosition(
      position.id,
      110,
      market,
      positionManager,
      vault,
    );

    expect(result.pnl).toBe(1_000);
    expect(result.traderSettlement).toBe(2_000);
    expect(result.releasedOpenInterest).toBe(100);

    expect(vault.traderPnL).toBe(1_000);
    expect(vault.availableCapital).toBe(49_000);

    expect(market.longOpenInterest).toBe(0);
    expect(
      positionManager.getPosition(position.id),
    ).toBeUndefined();
  });

  it("settles a losing SHORT and closes it", () => {
    const vault = createLiquidityVault(50_000);

    const market = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 0,
      shortOpenInterest: 100,
    };

    const positionManager = new PositionManager();

    const position = {
      id: "position-2",
      trader: "Bob",
      market: "BTC-PERP",
      side: "SHORT" as const,
      size: 100,
      entryPrice: 100,
      margin: 1_000,
    };

    positionManager.openPosition(position);

    const result = settleAndClosePosition(
      position.id,
      110,
      market,
      positionManager,
      vault,
    );

    expect(result.pnl).toBe(-1_000);
    expect(result.traderSettlement).toBe(0);

    expect(vault.traderPnL).toBe(-1_000);
    expect(vault.availableCapital).toBe(51_000);

    expect(market.shortOpenInterest).toBe(0);
    expect(
      positionManager.getPosition(position.id),
    ).toBeUndefined();
  });

  it("does not mutate the vault when the position does not exist", () => {
    const vault = createLiquidityVault(50_000);

    const market = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 100,
      shortOpenInterest: 0,
    };

    const positionManager = new PositionManager();

    expect(() =>
      settleAndClosePosition(
        "missing-position",
        110,
        market,
        positionManager,
        vault,
      ),
    ).toThrow("POSITION_NOT_FOUND");

    expect(vault.traderPnL).toBe(0);
    expect(vault.availableCapital).toBe(50_000);
    expect(market.longOpenInterest).toBe(100);
  });
});