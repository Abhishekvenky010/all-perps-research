import { describe, it, expect } from "vitest";

import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";

import { SimulatedPriceFeed } from "../src/oracle/SimulatedPriceFeed.js";
import { recordSimulatedPriceAndUpdateTwap } from "../src/oracle/SimulatedPriceFeedService.js";
import { advanceSimulation } from "../src/simulation/advanceSimulation.js";
import type { SimulationEnvironment } from "../src/simulation/SimulationEnvironment.js";

const config: MarketConfig = {
  symbol: "BTC-PERP",
  maxCapacity: 100_000,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 20,
};

function createEnvironment(): SimulationEnvironment {
  const market: MarketState = {
    symbol: "BTC-PERP",
    indexPrice: 100,
    ammTwapPrice: 100,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };

  const priceFeed = new SimulatedPriceFeed();

  const seededMarket = recordSimulatedPriceAndUpdateTwap(
    market,
    priceFeed,
    100,
    0,
  );

  return {
    market: seededMarket,
    config,
    priceFeed,
    timestamp: 0,
  };
}

describe("SimulationEnvironment", () => {
  it("advances the simulation clock", () => {
    const environment = createEnvironment();

    const next = advanceSimulation(environment, 300);

    expect(next.timestamp).toBe(300);
  });

  it("preserves the market configuration", () => {
    const environment = createEnvironment();

    const next = advanceSimulation(environment, 300);

    expect(next.config).toBe(config);
  });

  it("records an AMM price observation", () => {
    const environment = createEnvironment();

    const next = advanceSimulation(environment, 300);

    const observations =
      next.priceFeed.getObservations();

    expect(observations).toHaveLength(2);
    expect(observations.at(-1)?.timestamp).toBe(300);
  });

  it("rejects invalid time steps", () => {
    const environment = createEnvironment();

    expect(() => advanceSimulation(environment, 0)).toThrow(
      "INVALID_TIME_STEP",
    );

    expect(() => advanceSimulation(environment, -100)).toThrow(
      "INVALID_TIME_STEP",
    );
  });
});