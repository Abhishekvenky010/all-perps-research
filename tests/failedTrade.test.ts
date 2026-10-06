import { describe, it, expect } from "vitest";
import { simulateTrade } from "../src/simulation/TradeSimulator.js";
import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";
import { PositionManager } from "../src/position/PositionManager.js";

describe("Failed trade atomicity", () => {
  it("accepts the leverage boundary and rejects leverage above it", () => {
    const state: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      longOpenInterest: 0,
      shortOpenInterest: 0,
      ammTwapPrice: 100,
    };
    const config: MarketConfig = {
      symbol: "BTC-PERP",
      maxCapacity: 100_000,
      skewCoefficient: 0.2,
      capacityCoefficient: 0.05,
      maxLeverage: 20,
    };
    const positionManager = new PositionManager();

    const boundaryTrade = simulateTrade(
      state,
      "LONG",
      2_000,
      1,
      config,
      "boundary-trader",
      100,
      positionManager,
    );
    expect(boundaryTrade.position.size / boundaryTrade.position.margin).toBe(20);

    const stateBefore = { ...state };
    expect(() =>
      simulateTrade(
        state,
        "LONG",
        2_000,
        1,
        config,
        "over-leverage",
        99,
        positionManager,
      ),
    ).toThrow("MAX_LEVERAGE_EXCEEDED");

    expect(state).toEqual(stateBefore);
    expect(positionManager.getAllPositions()).toHaveLength(1);
  });

  it("does not modify market state when capacity is exceeded", () => {
    const state: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      longOpenInterest: 0,
      shortOpenInterest: 0,
      ammTwapPrice: 100,
    };

    const config: MarketConfig = {
      symbol: "BTC-PERP",
      maxCapacity: 100_000,
      skewCoefficient: 0.2,
      capacityCoefficient: 0.05,
      maxLeverage: 20,
    };

    const positionManager = new PositionManager();
    positionManager.openPosition({
      id: "existing-long",
      trader: "trader-long",
      market: state.symbol,
      side: "LONG",
      size: 90_000,
      entryPrice: 100,
      margin: 5_000,
    }, state);
    positionManager.openPosition({
      id: "existing-short",
      trader: "trader-short",
      market: state.symbol,
      side: "SHORT",
      size: 5_000,
      entryPrice: 100,
      margin: 1_000,
    }, state);

    const originalState = { ...state };

    expect(() =>
      simulateTrade(
        state,
        "LONG",
        10_000,
        10,
        config,
        "trader-1",
        1_000,
        positionManager,
      ),
    ).toThrow("MARKET_CAPACITY_EXCEEDED");

    expect(state).toEqual(originalState);
    expect(positionManager.getAllPositions()).toHaveLength(2);
  });

  it("rejects invalid requested sizes and step counts without mutation", () => {
    const state: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      longOpenInterest: 0,
      shortOpenInterest: 0,
      ammTwapPrice: 100,
    };
    const config: MarketConfig = {
      symbol: "BTC-PERP",
      maxCapacity: 100_000,
      skewCoefficient: 0.2,
      capacityCoefficient: 0.05,
      maxLeverage: 20,
    };
    const positionManager = new PositionManager();
    const originalState = { ...state };

    for (const size of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        simulateTrade(
          state,
          "LONG",
          size,
          1,
          config,
          "trader-1",
          1,
          positionManager,
        ),
      ).toThrow("INVALID_TRADE_SIZE");
    }

    for (const steps of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        simulateTrade(
          state,
          "LONG",
          1,
          steps,
          config,
          "trader-1",
          1,
          positionManager,
        ),
      ).toThrow("INVALID_TRADE_STEPS");
    }

    expect(state).toEqual(originalState);
    expect(positionManager.getAllPositions()).toHaveLength(0);
  });
});