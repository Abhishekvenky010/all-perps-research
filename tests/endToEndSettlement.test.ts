import { describe, expect, it } from "vitest";

import type { MarketState } from "../src/market/MarketState.js";
import type { Position } from "../src/position/Position.js";

import {
  createLiquidityVault,
  getLpEquity,
} from "../src/liquidity/LiquidityVault.js";

import { PositionManager } from "../src/position/PositionManager.js";
import { settleAndClosePosition } from "../src/settlement/SettleAndClosePosition.js";

describe("End-to-end economic settlement", () => {
  it("settles a profitable position against the LP vault and releases OI", () => {
    const market: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 10_000,
      shortOpenInterest: 0,
    };

    const vault = createLiquidityVault(50_000);

    const positionManager = new PositionManager();

    const position: Position = {
      id: "position-1",
      trader: "alice",
      market: "BTC-PERP",
      side: "LONG",
      size: 10_000,
      entryPrice: 100,
      margin: 2_000,
    };

    positionManager.openPosition(position);

    const result = settleAndClosePosition(
      position.id,
      110,
      market,
      positionManager,
      vault,
    );

    // Trader made:
    // (110 - 100) * 10,000 = 100,000
    expect(result.pnl).toBe(100_000);
    expect(result.traderSettlement).toBe(102_000);

    // Position was closed and OI released.
    expect(market.longOpenInterest).toBe(0);
    expect(positionManager.getPosition(position.id)).toBeUndefined();

    // LP vault absorbed the trader's profit.
    expect(vault.traderPnL).toBe(100_000);
    expect(vault.availableCapital).toBe(-50_000);

    // Accounting identity still holds.
    expect(getLpEquity(vault)).toBe(-50_000);
  });
});
