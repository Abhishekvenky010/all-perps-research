import { describe, it, expect } from "vitest";

import {
  getAverageExecutionPrice,
} from "../src/amm/Pricing.js";

import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";

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
    ammTwapPrice: 101,
    longOpenInterest,
    shortOpenInterest,
  };
}

describe("Average-based pricing", () => {
  it("prices a balanced market", () => {
    const state = createState(20_000, 20_000);

    const price = getAverageExecutionPrice(
      state,
      config,
      "LONG",
    );

    expect(price).toBeCloseTo(102.6833, 2);
  });

  it("prices a crowded long market", () => {
    const state = createState(60_000, 20_000);

    const price = getAverageExecutionPrice(
      state,
      config,
      "LONG",
    );

    expect(price).toBeCloseTo(115.14, 2);
  });

  it("returns a lower price for SHORT than LONG", () => {
    const state = createState(60_000, 20_000);

    const longPrice = getAverageExecutionPrice(
      state,
      config,
      "LONG",
    );

    const shortPrice = getAverageExecutionPrice(
      state,
      config,
      "SHORT",
    );

    expect(shortPrice).toBeLessThan(longPrice);
  });
});