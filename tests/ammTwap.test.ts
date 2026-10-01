
import { describe, it, expect } from "vitest";

import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";

import { recordAmmPriceObservation } from "../src/oracle/AmmPriceService.js";

import {
  calculateTWAP,
  type PriceObservation,
} from "../src/oracle/TWAPOracle.js";

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

describe("AMM price observations and TWAP", () => {
  it("records the current AMM price", () => {
    const state = makeState(50_000, 0);

    const observations = recordAmmPriceObservation(
      [],
      state,
      config,
      0,
    );

    expect(observations).toHaveLength(1);
    expect(observations[0]?.price).toBeCloseTo(110, 10);
    expect(observations[0]?.timestamp).toBe(0);
  });

  it("smooths a temporary AMM price spike", () => {
    let observations: PriceObservation[] = [];

    observations = recordAmmPriceObservation(
      observations,
      makeState(0, 0),
      config,
      0,
    );

    observations = recordAmmPriceObservation(
      observations,
      makeState(50_000, 0),
      config,
      450,
    );

    observations = recordAmmPriceObservation(
      observations,
      makeState(0, 0),
      config,
      900,
    );

    const twap = calculateTWAP(observations, 900);

    expect(twap).not.toBeNull();

    // 100 for 450 seconds + 110 for 450 seconds.
    expect(twap).toBeCloseTo(105, 5);

    // The temporary manipulation does not immediately
    // make the TWAP equal to the manipulated price.
    expect(twap).toBeLessThan(110);
  });
});
