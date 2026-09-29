import { describe, it, expect, vi } from "vitest";
import { simulateTrade } from "../src/simulation/TradeSimulator.js";
import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";
import type { PositionManager } from "../src/position/PositionManager.js";

describe("Failed trade atomicity", () => {
  it("does not modify market state when capacity is exceeded", () => {
    const state: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      longOpenInterest: 90_000,
      shortOpenInterest: 5_000,
      ammTwapPrice: 100,
    };

    const config: MarketConfig = {
      symbol: "BTC-PERP",
      maxCapacity: 100_000,
      skewCoefficient: 0.2,
      capacityCoefficient: 0.05,
      maxLeverage: 20,
    };

    const positionManager = {
      openPosition: vi.fn(),
    } as unknown as PositionManager;

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
    expect(positionManager.openPosition).not.toHaveBeenCalled();
  });
});