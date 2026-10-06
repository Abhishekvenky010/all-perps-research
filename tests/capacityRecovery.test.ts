import { describe, expect, it } from "vitest";

import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";

import { PositionManager } from "../src/position/PositionManager.js";
import { simulateTrade } from "../src/simulation/TradeSimulator.js";
import { closePosition } from "../src/position/ClosePosition.js";
import { liquidatePosition } from "../src/risk/LiquidationEngine.js";
import { createLiquidityVault } from "../src/liquidity/LiquidityVault.js";
import { createMarketConfig } from "./helpers/marketConfig.js";

describe("Capacity recovery after closing", () => {
  it("releases capacity and allows new exposure", () => {
    const config: MarketConfig = {
      symbol: "BTC-PERP",
      maxCapacity: 100_000,
      skewCoefficient: 0.2,
      capacityCoefficient: 0.05,
      maxLeverage: 20,
    };

    const market: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 0,
      shortOpenInterest: 0,
    };

    const positionManager = new PositionManager();
    positionManager.openPosition({
      id: "existing-long",
      trader: "existing-long",
      market: market.symbol,
      side: "LONG",
      size: 40_000,
      entryPrice: 100,
      margin: 2_000,
    }, market);
    positionManager.openPosition({
      id: "existing-short",
      trader: "existing-short",
      market: market.symbol,
      side: "SHORT",
      size: 40_000,
      entryPrice: 100,
      margin: 2_000,
    }, market);

    // Fill the market to capacity.
    const firstTrade = simulateTrade(
      market,
      "LONG",
      20_000,
      10,
      config,
      "trader-1",
      1_000,
      positionManager,
    );

    expect(
      firstTrade.finalState.longOpenInterest +
        firstTrade.finalState.shortOpenInterest,
    ).toBe(100_000);

    // Close the newly opened position.
    closePosition(
      firstTrade.position.id,
      market,
      config,
      positionManager,
      createLiquidityVault(50_000),
    );

    expect(
      market.longOpenInterest +
        market.shortOpenInterest,
    ).toBe(80_000);

    // Capacity should now be available again.
    const secondTrade = simulateTrade(
      market,
      "LONG",
      20_000,
      10,
      config,
      "trader-2",
      1_000,
      positionManager,
    );

    expect(
      secondTrade.finalState.longOpenInterest +
        secondTrade.finalState.shortOpenInterest,
    ).toBe(100_000);
  });
  it("does not liquidate at exactly the maintenance margin", () => {
  const manager = new PositionManager();

  const market = {
    symbol: "BTC-PERP",
    indexPrice: 100,
    ammTwapPrice: 100,

    longOpenInterest: 0,
    shortOpenInterest: 0,
  };

  const position = {
    id: "pos-boundary",

    trader: "Dave",

    market: "BTC-PERP",

    side: "LONG" as const,

    size: 100,

    entryPrice: 100,

    // Equity = 5
    // Margin ratio = 5 / 100 = 0.05
    margin: 5,
  };

  manager.openPosition(position, market);

  expect(() =>
    liquidatePosition(
      position,
      market,
      createMarketConfig(),
      manager,
      createLiquidityVault(50_000),
      0.05,
    ),
  ).toThrow("POSITION_HEALTHY");

  expect(
    manager.getPosition("pos-boundary"),
  ).toBeDefined();

  expect(
    market.longOpenInterest,
  ).toBe(100);
});
});