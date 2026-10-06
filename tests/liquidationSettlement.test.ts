import { describe, expect, it } from "vitest";
import { createLiquidityVault } from "../src/liquidity/LiquidityVault.js";
import { PositionManager } from "../src/position/PositionManager.js";
import { settleAndLiquidatePosition } from "../src/settlement/SettleAndLiquidatePosition.js";
import { createMarketConfig } from "./helpers/marketConfig.js";

describe("Liquidation settlement", () => {
  it("atomically settles liquidated trader loss against the LP vault", () => {
    const vault = createLiquidityVault(50_000);
    const market = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 90,
      longOpenInterest: 0,
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
    positionManager.openPosition(position, market);

    const result = settleAndLiquidatePosition(
      position.id,
      market,
      createMarketConfig(),
      positionManager,
      vault,
      0.05,
    );

    expect(result.realizedPnL).toBe(-1_000);
    expect(result.remainingMargin).toBe(0);
    expect(result.closed).toBe(true);
    expect(result.lifecycle).toBe("LIQUIDATED");
    expect(result.side).toBe("LONG");
    expect(result.size).toBe(100);
    expect(result.entryPrice).toBe(100);
    expect(result.settlementPrice).toBe(90);
    expect(vault.traderPnL).toBe(-1_000);
    expect(vault.availableCapital).toBe(51_000);
    expect(market.longOpenInterest).toBe(0);
    expect(positionManager.getPositionLifecycle(position.id)).toBe("LIQUIDATED");
  });

  it("preserves positive remaining margin after liquidation", () => {
    const vault = createLiquidityVault(50_000);
    const market = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 90.4,
      longOpenInterest: 0,
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
    positionManager.openPosition(position, market);

    const result = settleAndLiquidatePosition(
      position.id,
      market,
      createMarketConfig(),
      positionManager,
      vault,
      0.5,
    );

    expect(result.realizedPnL).toBeCloseTo(-960);
    expect(result.remainingMargin).toBeCloseTo(40);
    expect(vault.traderPnL).toBeCloseTo(-960);
    expect(vault.availableCapital).toBeCloseTo(50_960);
    expect(market.longOpenInterest).toBe(0);
    expect(positionManager.getPositionLifecycle(position.id)).toBe("LIQUIDATED");
  });

  it("uses the canonical LONG PnL and permits a backed positive liquidation claim", () => {
    const vault = createLiquidityVault(10);
    const market = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100.001,
      longOpenInterest: 0,
      shortOpenInterest: 0,
    };
    const positionManager = new PositionManager();
    const position = {
      id: "profitable-liquidation",
      trader: "Alice",
      market: "BTC-PERP",
      side: "LONG" as const,
      size: 100,
      entryPrice: 100,
      margin: 1,
    };
    positionManager.openPosition(position, market);

    const result = settleAndLiquidatePosition(
      position.id,
      market,
      createMarketConfig(),
      positionManager,
      vault,
      0.05,
    );

    expect(result.pnl).toBeCloseTo((result.settlementPrice - 100) * 100);
    expect(result.remainingMargin).toBeCloseTo(1 + result.pnl);
    expect(result.traderSettlement).toBe(result.remainingMargin);
    expect(result.marginRatio).toBeLessThan(0.05);
    expect(vault.availableCapital).toBeGreaterThanOrEqual(0);
    expect(positionManager.getPositionLifecycle(position.id)).toBe("LIQUIDATED");
  });

  it("rejects an unfunded liquidation claim without changing any state", () => {
    const vault = createLiquidityVault(1);
    const market = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100.01,
      longOpenInterest: 0,
      shortOpenInterest: 0,
    };
    const positionManager = new PositionManager();
    const position = {
      id: "unfunded-claim",
      trader: "Alice",
      market: "BTC-PERP",
      side: "LONG" as const,
      size: 100,
      entryPrice: 100,
      margin: 1,
    };
    positionManager.openPosition(position, market);
    const before = {
      market: { ...market },
      position: positionManager.getPosition(position.id),
      lifecycle: positionManager.getPositionLifecycle(position.id),
      vault: { ...vault },
    };

    expect(() =>
      settleAndLiquidatePosition(
        position.id,
        market,
        createMarketConfig(),
        positionManager,
        vault,
        0.05,
      ),
    ).toThrow("INSUFFICIENT_LP_BACKING");

    expect({
      market: { ...market },
      position: positionManager.getPosition(position.id),
      lifecycle: positionManager.getPositionLifecycle(position.id),
      vault: { ...vault },
    }).toEqual(before);
  });

  it("floors zero and negative-equity liquidation claims at zero", () => {
    for (const [id, margin, price, expectedPnl, expectedEquity] of [
      ["zero-equity", 10, 90, -10, 0],
      ["negative-equity", 1, 90, -10, -9],
    ] as const) {
      const vault = createLiquidityVault(50);
      const market = {
        symbol: "BTC-PERP",
        indexPrice: 100,
        ammTwapPrice: price,
        longOpenInterest: 0,
        shortOpenInterest: 0,
      };
      const positionManager = new PositionManager();
      const position = {
        id,
        trader: "Alice",
        market: "BTC-PERP",
        side: "LONG" as const,
        size: 1,
        entryPrice: 100,
        margin,
      };
      positionManager.openPosition(position, market);

      const result = settleAndLiquidatePosition(
        position.id,
        market,
        createMarketConfig(),
        positionManager,
        vault,
        0.05,
      );

      expect(result.pnl).toBe(expectedPnl);
      expect(result.remainingMargin).toBe(Math.max(expectedEquity, 0));
      expect(result.traderSettlement).toBe(0);
      expect(vault.availableCapital).toBe(60);
      expect(vault.traderPnL).toBe(-10);
    }
  });

  it("uses SHORT-side PnL for liquidation", () => {
    const vault = createLiquidityVault(100);
    const market = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 110,
      longOpenInterest: 0,
      shortOpenInterest: 0,
    };
    const positionManager = new PositionManager();
    const position = {
      id: "short-liquidation",
      trader: "Bob",
      market: "BTC-PERP",
      side: "SHORT" as const,
      size: 10,
      entryPrice: 100,
      margin: 1,
    };
    positionManager.openPosition(position, market);

    const result = settleAndLiquidatePosition(
      position.id,
      market,
      createMarketConfig(),
      positionManager,
      vault,
      0.05,
    );

    expect(result.pnl).toBe((100 - 110) * 10);
    expect(result.pnl).toBe(-100);
    expect(result.remainingMargin).toBe(0);
    expect(market.shortOpenInterest).toBe(0);
    expect(vault.traderPnL).toBe(-100);
    expect(vault.availableCapital).toBe(200);
  });
});
