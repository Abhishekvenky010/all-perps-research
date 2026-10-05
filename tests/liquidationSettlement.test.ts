import { describe, it, expect } from "vitest";

import {
  createLiquidityVault,
  recordTraderPnL,
} from "../src/liquidity/LiquidityVault.js";

import {
  liquidatePosition,
} from "../src/risk/LiquidationEngine.js";

import {
  PositionManager,
} from "../src/position/PositionManager.js";

describe("Liquidation settlement", () => {
  it("settles liquidated trader loss against LP vault", () => {
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

    // LONG loses $1,000:
    // (90 - 100) * 100 = -1,000
    const result = liquidatePosition(
      position,
      90,
      market,
      positionManager,
      0.05,
    );

    // Existing liquidation semantics.
    expect(result.realizedPnL).toBe(-1_000);
    expect(result.remainingMargin).toBe(0);
    expect(result.closed).toBe(true);

    // For now we explicitly connect the liquidation result
    // to LP accounting outside LiquidationEngine.
    recordTraderPnL(
      vault,
      result.realizedPnL,
    );

    expect(vault.traderPnL).toBe(-1_000);
    expect(vault.availableCapital).toBe(51_000);

    // Liquidation released the exposure.
    expect(market.longOpenInterest).toBe(0);

    // Position was removed.
    expect(
      positionManager.getPosition(position.id),
    ).toBeUndefined();
  });

  it("preserves positive remaining margin after liquidation", () => {
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

    // PnL = (90.4 - 100) * 100
    //     = -960
    //
    // Equity = 1,000 - 960
    //        = 40
    //
    // Margin ratio = 40 / 100
    //              = 0.4
    //
    // Use a deliberately high maintenance threshold
    // so this position is liquidatable while still
    // having positive remaining margin.
    const result = liquidatePosition(
      position,
      90.4,
      market,
      positionManager,
      0.5,
    );

    expect(result.realizedPnL).toBeCloseTo(-960);
    expect(result.remainingMargin).toBeCloseTo(40);

    recordTraderPnL(
      vault,
      result.realizedPnL,
    );

    expect(vault.traderPnL).toBeCloseTo(-960);
    expect(vault.availableCapital).toBeCloseTo(50_960);

    expect(market.longOpenInterest).toBe(0);

    expect(
      positionManager.getPosition(position.id),
    ).toBeUndefined();
  });
});