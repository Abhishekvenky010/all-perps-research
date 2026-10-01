import { describe, expect, it } from "vitest";

import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";
import { SimulatedPriceFeed } from "../src/oracle/SimulatedPriceFeed.js";
import { recordAmmPriceObservation } from "../src/oracle/AmmPriceService.js";
import { updateAmmTwap } from "../src/oracle/TWAPOracle.js";

describe("Oracle ↔ AMM integration", () => {
  it("builds a TWAP from AMM price observations", () => {
    const config: MarketConfig = {
      symbol: "BTC-PERP",
      maxCapacity: 100_000,
      skewCoefficient: 0.2,
      capacityCoefficient: 0.05,
      maxLeverage: 20,
    };

    const state: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 20_000,
      shortOpenInterest: 10_000,
    };

    const feed = new SimulatedPriceFeed();

    let observations = feed.getObservations();

    observations = recordAmmPriceObservation(
      observations,
      state,
      config,
      0,
    );

    observations = recordAmmPriceObservation(
      observations,
      state,
      config,
      300,
    );

    observations = recordAmmPriceObservation(
      observations,
      state,
      config,
      600,
    );

    observations = recordAmmPriceObservation(
      observations,
      state,
      config,
      900,
    );

    const updatedState = updateAmmTwap(
      state,
      observations,
      900,
    );

    expect(observations).toHaveLength(4);

    expect(updatedState.ammTwapPrice).toBeGreaterThan(0);

    console.log("AMM observations:", observations);
    console.log("Calculated TWAP:", updatedState.ammTwapPrice);
  });
});