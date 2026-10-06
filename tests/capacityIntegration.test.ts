import { describe, expect, it } from "vitest";

import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";

import { PositionManager } from "../src/position/PositionManager.js";
import { simulateTrade } from "../src/simulation/TradeSimulator.js";

describe("Bounded market capacity", () => {
  const config: MarketConfig = {
    symbol: "BTC-PERP",
    maxCapacity: 100_000,
    skewCoefficient: 0.2,
    capacityCoefficient: 0.05,
    maxLeverage: 20,
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

  function seedOpenInterest(
    state: MarketState,
    positionManager: PositionManager,
    longSize: number,
    shortSize: number,
  ) {
    if (longSize > 0) {
      positionManager.openPosition({
        id: "existing-long",
        trader: "existing-long",
        market: state.symbol,
        side: "LONG",
        size: longSize,
        entryPrice: 100,
        margin: longSize,
      }, state);
    }
    if (shortSize > 0) {
      positionManager.openPosition({
        id: "existing-short",
        trader: "existing-short",
        market: state.symbol,
        side: "SHORT",
        size: shortSize,
        entryPrice: 100,
        margin: shortSize,
      }, state);
    }
  }

  it("allows a trade below market capacity", () => {
    const state = createState(0, 0);
    const positionManager = new PositionManager();
    seedOpenInterest(state, positionManager, 40_000, 30_000);

    const result = simulateTrade(
      state,
      "LONG",
      10_000,
      10,
      config,
      "trader-1",
      1_000,
      positionManager,
    );

    expect(result.finalState.longOpenInterest).toBe(50_000);

    expect(
      result.finalState.longOpenInterest +
        result.finalState.shortOpenInterest,
    ).toBe(80_000);
  });

  it("allows exposure up to the capacity boundary", () => {
    const state = createState(0, 0);
    const positionManager = new PositionManager();
    seedOpenInterest(state, positionManager, 40_000, 40_000);

    const result = simulateTrade(
      state,
      "LONG",
      20_000,
      10,
      config,
      "trader-2",
      1_000,
      positionManager,
    );

    const totalOI =
      result.finalState.longOpenInterest +
      result.finalState.shortOpenInterest;

    expect(totalOI).toBe(100_000);
  });

  it("rejects a trade that exceeds market capacity", () => {
    const state = createState(0, 0);
    const positionManager = new PositionManager();
    seedOpenInterest(state, positionManager, 50_000, 40_000);

    expect(() => {
      simulateTrade(
        state,
        "LONG",
        20_000,
        10,
        config,
        "trader-3",
        1_000,
        positionManager,
      );
    }).toThrow("MARKET_CAPACITY_EXCEEDED");
  });
});