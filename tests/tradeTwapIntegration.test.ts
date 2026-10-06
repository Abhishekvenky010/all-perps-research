import { describe, it, expect } from "vitest";

import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";

import { SimulatedPriceFeed } from "../src/oracle/SimulatedPriceFeed.js";
import { recordSimulatedPriceAndUpdateTwap } from "../src/oracle/SimulatedPriceFeedService.js";
import { advanceSimulation } from "../src/simulation/advanceSimulation.js";
import type { SimulationEnvironment } from "../src/simulation/SimulationEnvironment.js";

import { simulateTrade } from "../src/simulation/TradeSimulator.js";
import { PositionManager } from "../src/position/PositionManager.js";

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

describe("Trade and AMM TWAP integration", () => {
  it("records the new AMM price after a trade changes skew", () => {
    let environment = createEnvironment();

    // Build a complete 15-minute prototype history.
    environment = advanceSimulation(environment, 300);
    environment = advanceSimulation(environment, 300);
    environment = advanceSimulation(environment, 300);

    expect(environment.timestamp).toBe(900);
    expect(environment.market.ammTwapPrice).toBeCloseTo(100, 10);

    const positionManager = new PositionManager();

    // Increase long skew.
    simulateTrade(
      environment.market,
      "LONG",
      10_000,
      10,
      environment.config,
      "trader",
      1_000,
      positionManager,
    );

    expect(environment.market.longOpenInterest).toBe(10_000);
    expect(environment.market.shortOpenInterest).toBe(0);

    // Move time forward and record the AMM price produced
    // by the new market skew.
    environment = advanceSimulation(environment, 300);

    const observations =
      environment.priceFeed.getObservations();

    const latestObservation = observations.at(-1);

    expect(latestObservation).toBeDefined();

    expect(latestObservation?.price).toBeCloseTo(102, 10);
    expect(latestObservation?.timestamp).toBe(1200);

    // The new 102 price has only just entered the 15-minute
    // window, so the TWAP remains 100.
    expect(environment.market.ammTwapPrice).toBeCloseTo(100, 10);
  });
  it("moves the TWAP toward a sustained AMM price", () => {
  let environment = createEnvironment();

  environment = advanceSimulation(environment, 300);
  environment = advanceSimulation(environment, 300);
  environment = advanceSimulation(environment, 300);

  const positionManager = new PositionManager();

  simulateTrade(
    environment.market,
    "LONG",
    10_000,
    10,
    environment.config,
    "trader",
    1_000,
    positionManager,
  );

  environment = advanceSimulation(environment, 300);

  const twapAfterOneStep = environment.market.ammTwapPrice;

  environment = advanceSimulation(environment, 300);
  const twapAfterTwoSteps = environment.market.ammTwapPrice;

  environment = advanceSimulation(environment, 300);
  const twapAfterThreeSteps = environment.market.ammTwapPrice;

  expect(twapAfterOneStep).toBeCloseTo(100, 10);

  expect(twapAfterTwoSteps).toBeGreaterThan(
    twapAfterOneStep,
  );

  expect(twapAfterThreeSteps).toBeGreaterThan(
    twapAfterTwoSteps,
  );

  expect(twapAfterThreeSteps).toBeLessThan(102);
});
});