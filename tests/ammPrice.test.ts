import { describe, it, expect } from "vitest";
import { getCurrentAmmPrice } from "../src/amm/Pricing.js";
import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";

const config: MarketConfig = {
  symbol: "BTC-PERP",
  maxCapacity: 100_000,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 20,
};

function makeState(
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

describe("Current AMM price", () => {
  it("stays at TWAP when the market is balanced", () => {
    const state = makeState(0, 0);

    expect(
      getCurrentAmmPrice(state, config),
    ).toBe(100);
  });

  it("moves above TWAP when long skew is positive", () => {
    const state = makeState(50_000, 0);

    const price = getCurrentAmmPrice(state, config);

    expect(price).toBeGreaterThan(100);
  });

  it("moves below TWAP when short skew is negative", () => {
    const state = makeState(0, 50_000);

    const price = getCurrentAmmPrice(state, config);

    expect(price).toBeLessThan(100);
  });

  it("moves symmetrically for equal long and short skew", () => {
    const longState = makeState(50_000, 0);
    const shortState = makeState(0, 50_000);

    const longPrice = getCurrentAmmPrice(
      longState,
      config,
    );

    const shortPrice = getCurrentAmmPrice(
      shortState,
      config,
    );

    expect(longPrice - 100).toBeCloseTo(
      100 - shortPrice,
      10,
    );
  });
});