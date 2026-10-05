import { describe, it, expect } from "vitest";

import {
  createLiquidityVault,
} from "../src/liquidity/LiquidityVault.js";

import {
  settlePosition,
} from "../src/settlement/PositionSettlement.js";

import {
  closePosition,
} from "../src/position/ClosePosition.js";

import {
  PositionManager,
} from "../src/position/PositionManager.js";

describe("Close settlement integration", () => {
  it("settles trader profit and releases LONG OI", () => {
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

    const settlement = settlePosition(
      position,
      110,
      vault,
    );

    const closedPosition = closePosition(
      position.id,
      market,
      positionManager,
    );

    expect(settlement.pnl).toBe(1_000);
    expect(settlement.traderSettlement).toBe(2_000);

    expect(vault.traderPnL).toBe(1_000);
    expect(vault.availableCapital).toBe(49_000);

    expect(market.longOpenInterest).toBe(0);

    expect(closedPosition.id).toBe(position.id);
    expect(
      positionManager.getPosition(position.id),
    ).toBeUndefined();
  });

  it("settles trader loss and releases SHORT OI", () => {
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

    const settlement = settlePosition(
      position,
      110,
      vault,
    );

    const closedPosition = closePosition(
      position.id,
      market,
      positionManager,
    );

    expect(settlement.pnl).toBe(-1_000);
    expect(settlement.traderSettlement).toBe(0);

    expect(vault.traderPnL).toBe(-1_000);
    expect(vault.availableCapital).toBe(51_000);

    expect(market.shortOpenInterest).toBe(0);

    expect(closedPosition.id).toBe(position.id);
    expect(
      positionManager.getPosition(position.id),
    ).toBeUndefined();
  });
});