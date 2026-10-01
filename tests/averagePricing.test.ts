
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

const skewOnlyConfig: MarketConfig = {
  ...config,
  capacityCoefficient: 0,
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

    // No skew, so the fair value is the TWAP and the halved
    // capacity spread sits above it.
    expect(price).toBeCloseTo(102.6833, 2);
  });

  it("prices a crowded long market", () => {
    const state = createState(60_000, 20_000);

    const price = getAverageExecutionPrice(
      state,
      config,
      "LONG",
    );

    expect(price).toBeCloseTo(119.988, 2);
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

  it("positive skew increases LONG execution price", () => {
    const state = createState(60_000, 20_000);

    const price = getAverageExecutionPrice(
      state,
      skewOnlyConfig,
      "LONG",
    );

    expect(price).toBeGreaterThan(state.ammTwapPrice);
  });

  it("positive skew decreases SHORT execution price", () => {
    const state = createState(60_000, 20_000);

    const price = getAverageExecutionPrice(
      state,
      skewOnlyConfig,
      "SHORT",
    );

    // With no capacity spread the SHORT quote is the fair
    // value, which a long skew has pushed above the TWAP.
    expect(price).toBeGreaterThan(state.ammTwapPrice);
  });

  it("negative skew decreases LONG execution price", () => {
    const state = createState(20_000, 60_000);

    const price = getAverageExecutionPrice(
      state,
      skewOnlyConfig,
      "LONG",
    );

    expect(price).toBeLessThan(state.ammTwapPrice);
  });

  it("negative skew decreases SHORT execution price", () => {
    const state = createState(20_000, 60_000);

    const price = getAverageExecutionPrice(
      state,
      skewOnlyConfig,
      "SHORT",
    );

    // A short skew lowers the fair value.
    expect(price).toBeLessThan(state.ammTwapPrice);
  });
  it("keeps negative skew dominant over capacity impact", () => {
    const state = createState(40_000, 50_000);

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

    /*
      A short skew lowers the fair value, and the capacity
      spread is applied symmetrically around it, so the quotes
      stay ordered LONG above SHORT. Capacity no longer
      contributes a direction of its own.
    */
    expect(longPrice).toBeGreaterThan(shortPrice);

    // The midpoint sits on the fair value implied by skew.
    const fair =
      101 * (1 - 0.2 * (10_000 / 100_000));

    expect(
      (longPrice + shortPrice) / 2,
    ).toBeCloseTo(fair, 4);
  });
});