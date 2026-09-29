
import { simulateTrade } from "../src/simulation/TradeSimulator.js";
import { PositionManager } from "../src/position/PositionManager.js";
import type { MarketState } from "../src/market/MarketState.js";
import { SimulatedPriceFeed } from "../src/oracle/SimulatedPriceFeed.js";
import { recordPriceAndUpdateTwap } from "../src/oracle/PriceFeedService.js";

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
): MarketState {
  let state: MarketState = {
    symbol: "BTC-PERP",
    indexPrice: 100,
    ammTwapPrice: 100,
    longOpenInterest,
    shortOpenInterest,
  };

  const feed = new SimulatedPriceFeed();

  state = recordPriceAndUpdateTwap(state, feed, 100, 0);
  state = recordPriceAndUpdateTwap(state, feed, 102, 300);
  state = recordPriceAndUpdateTwap(state, feed, 101, 600);
  state = recordPriceAndUpdateTwap(state, feed, 103, 900);

  return state;
}

function runScenario(
  name: string,
  state: MarketState,
  side: "LONG" | "SHORT",
  size: number,
) {
  console.log("\n====================");
  console.log(name);
  console.log("====================");

  try {
    const result = simulateTrade(
      state,
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