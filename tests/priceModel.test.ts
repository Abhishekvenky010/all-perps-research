import { describe, it, expect } from "vitest";

import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";

import {
  getCurrentAmmPrice,
} from "../src/amm/Pricing.js";

import {
  getSkewImpact,
  getCapacityImpact,
} from "../src/amm/ImpactModel.js";

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
  ammTwapPrice = 100,
): MarketState {
  return {
    symbol: "BTC-PERP",
    indexPrice: 100,
    ammTwapPrice,
    longOpenInterest,
    shortOpenInterest,
  };
}

describe("AMM price model", () => {
  it("has zero skew impact in a balanced market", () => {
    expect(
      getSkewImpact(0, config.skewCoefficient),
    ).toBe(0);
  });

  it("increases AMM price with positive skew", () => {
    const state = makeState(10_000, 0);

    const price = getCurrentAmmPrice(
      state,
      config,
    );

    expect(price).toBeCloseTo(102, 10);
  });

  it("decreases AMM price with negative skew", () => {
    const state = makeState(0, 10_000);

    const price = getCurrentAmmPrice(
      state,
      config,
    );

    expect(price).toBeCloseTo(98, 10);
  });

  it("moves the AMM price around the TWAP reference", () => {
    const state = makeState(
      10_000,
      0,
      200,
    );

    const price = getCurrentAmmPrice(
      state,
      config,
    );

    expect(price).toBeCloseTo(204, 10);
  });
});

describe("Capacity impact model", () => {
  it("is zero at zero capacity usage", () => {
    expect(
      getCapacityImpact(
        0,
        config.capacityCoefficient,
      ),
    ).toBe(0);
  });

  it("increases nonlinearly as capacity fills", () => {
    const low = getCapacityImpact(
      0.1,
      config.capacityCoefficient,
    );

    const medium = getCapacityImpact(
      0.5,
      config.capacityCoefficient,
    );

    const high = getCapacityImpact(
      0.9,
      config.capacityCoefficient,
    );

    expect(low).toBeLessThan(medium);
    expect(medium).toBeLessThan(high);
  });

  it("approaches a very large impact near capacity", () => {
    const impact = getCapacityImpact(
      0.99,
      config.capacityCoefficient,
    );

    expect(impact).toBeCloseTo(4.95, 10);
  });
});