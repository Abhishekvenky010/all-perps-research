import { describe, expect, it } from "vitest";
import { createLiquidityVault } from "../src/liquidity/LiquidityVault.js";
import { PositionManager } from "../src/position/PositionManager.js";
import { settleAndClosePosition } from "../src/settlement/SettleAndClosePosition.js";
import { createMarketConfig } from "./helpers/marketConfig.js";

describe("Close settlement integration", () => {
  it("atomically settles trader profit and releases LONG OI", () => {
    const vault = createLiquidityVault(50_000);
    const market = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 110,
      longOpenInterest: 0,
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
    positionManager.openPosition(position, market);

    const settlement = settleAndClosePosition(
      position.id,
      market,
      createMarketConfig(),
      positionManager,
      vault,
    );

    expect(settlement.pnl).toBe(1_000);
    expect(settlement.traderSettlement).toBe(2_000);
    expect(settlement.lifecycle).toBe("SETTLED");
    expect(settlement.side).toBe("LONG");
    expect(settlement.size).toBe(100);
    expect(settlement.entryPrice).toBe(100);
    expect(settlement.settlementPrice).toBe(110);
    expect(vault.traderPnL).toBe(1_000);
    expect(vault.availableCapital).toBe(49_000);
    expect(market.longOpenInterest).toBe(0);
    expect(positionManager.getPositionLifecycle(position.id)).toBe("SETTLED");
  });

  it("atomically settles trader loss and releases SHORT OI", () => {
    const vault = createLiquidityVault(50_000);
    const market = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 110,
      longOpenInterest: 0,
      shortOpenInterest: 0,
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
    positionManager.openPosition(position, market);

    const settlement = settleAndClosePosition(
      position.id,
      market,
      createMarketConfig(),
      positionManager,
      vault,
    );

    expect(settlement.pnl).toBe(-1_000);
    expect(settlement.traderSettlement).toBe(0);
    expect(vault.traderPnL).toBe(-1_000);
    expect(vault.availableCapital).toBe(51_000);
    expect(market.shortOpenInterest).toBe(0);
    expect(positionManager.getPositionLifecycle(position.id)).toBe("SETTLED");
  });
});
