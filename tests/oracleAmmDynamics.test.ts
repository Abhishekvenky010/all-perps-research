import { describe, expect, it } from "vitest";

import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";
import type { PriceObservation } from "../src/oracle/TWAPOracle.js";

import { recordAmmPriceObservation } from "../src/oracle/AmmPriceService.js";
import { updateAmmTwap } from "../src/oracle/TWAPOracle.js";

describe("Oracle ↔ AMM dynamics", () => {
  it("updates TWAP as AMM price changes with market skew", () => {
    const config: MarketConfig = {
      symbol: "BTC-PERP",
      maxCapacity: 100_000,
      skewCoefficient: 0.2,
      capacityCoefficient: 0.05,
      maxLeverage: 20,
    };

    let state: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 10_000,
      shortOpenInterest: 10_000,
    };

    let observations: PriceObservation[] = [];

    // t = 0: balanced market
    observations = recordAmmPriceObservation(
      observations,
      state,
      config,
      0,
    );

    // t = 300: increase long skew
    state = {
      ...state,
      longOpenInterest: 30_000,
      shortOpenInterest: 10_000,
    };

    observations = recordAmmPriceObservation(
      observations,
      state,
      config,
      300,
    );

    // t = 600: increase long skew further
    state = {
      ...state,
      longOpenInterest: 50_000,
      shortOpenInterest: 10_000,
    };

    observations = recordAmmPriceObservation(
      observations,
      state,
      config,
      600,
    );

    // t = 900: heavily skewed
    state = {
      ...state,
      longOpenInterest: 70_000,
      shortOpenInterest: 10_000,
    };

    observations = recordAmmPriceObservation(
      observations,
      state,
      config,
      900,
    );

    const finalState = updateAmmTwap(
      state,
      observations,
      900,
    );

    console.log("AMM observations:", observations);
    console.log("Final TWAP:", finalState.ammTwapPrice);

    expect(observations).toHaveLength(4);

    expect(observations[0]?.price).toBeLessThan(
      observations[1]?.price ?? Infinity,
    );

    expect(observations[1]?.price).toBeLessThan(
      observations[2]?.price ?? Infinity,
    );

    expect(observations[2]?.price).toBeLessThan(
      observations[3]?.price ?? Infinity,
    );

    expect(finalState.ammTwapPrice).toBeGreaterThan(
      observations[0]?.price ?? 0,
    );

    expect(finalState.ammTwapPrice).toBeLessThan(
      observations[3]?.price ?? Infinity,
    );
  });
});