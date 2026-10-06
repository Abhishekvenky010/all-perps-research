import { simulateTrade } from "../src/simulation/TradeSimulator.js";
import { PositionManager } from "../src/position/PositionManager.js";
import type { MarketState } from "../src/market/MarketState.js";
import { SimulatedPriceFeed } from "../src/oracle/SimulatedPriceFeed.js";
import { recordSimulatedPriceAndUpdateTwap } from "../src/oracle/SimulatedPriceFeedService.js";
import type { SimulationEnvironment } from "../src/simulation/SimulationEnvironment.js";

const config = {
  symbol: "BTC-PERP",
  maxCapacity: 100000,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 20,
};

const positionManager = new PositionManager();

function createScenarioState(
  longOpenInterest: number,
  shortOpenInterest: number,
): SimulationEnvironment {
  let market: MarketState = {
    symbol: "BTC-PERP",
    indexPrice: 100,
    ammTwapPrice: 100,
    longOpenInterest,
    shortOpenInterest,
  };

  const priceFeed = new SimulatedPriceFeed();

  market = recordSimulatedPriceAndUpdateTwap(
    market,
    priceFeed,
    100,
    0,
  );

  market = recordSimulatedPriceAndUpdateTwap(
    market,
    priceFeed,
    102,
    300,
  );

  market = recordSimulatedPriceAndUpdateTwap(
    market,
    priceFeed,
    101,
    600,
  );

  market = recordSimulatedPriceAndUpdateTwap(
    market,
    priceFeed,
    103,
    900,
  );

  return {
    market,
    config,
    priceFeed,
    timestamp: 900,
  };
}

function runScenario(
  name: string,
  environment: SimulationEnvironment,
  side: "LONG" | "SHORT",
  size: number,
) {
  console.log("\n====================");
  console.log(name);
  console.log("====================");

  try {
    const result = simulateTrade(
      environment.market,
      side,
      size,
      10,
      config,
      "trader",
      1000,
      positionManager,
    );

    console.log("Average execution price:", result.averagePrice);
    console.log("Price movement:", result.priceHistory);
    console.log("Final state:", result.finalState);
  } catch (error) {
    console.log("Trade rejected:", (error as Error).message);
  }
}

// Scenario 1
runScenario(
  "Healthy Market",
  createScenarioState(20000, 20000),
  "LONG",
  5000,
);

// Scenario 2
runScenario(
  "Long Crowded Market",
  createScenarioState(60000, 20000),
  "LONG",
  10000,
);

// Scenario 3
runScenario(
  "Capacity Stress",
  createScenarioState(90000, 5000),
  "LONG",
  10000,
);