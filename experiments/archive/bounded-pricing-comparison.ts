import {
  getExecutionPrice,
  getBoundedExecutionPrice,
} from "../../src/amm/Pricing.js";

import type { MarketState } from "../../src/market/MarketState.js";
import type { MarketConfig } from "../../src/config/MarketConfig.js";

const config: MarketConfig = {
  symbol: "BTC-PERP",
  maxCapacity: 100_000,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 20,
};

const scenarios = [
  {
    name: "Healthy Market",
    longOpenInterest: 20_000,
    shortOpenInterest: 20_000,
    tradeSize: 5_000,
  },
  {
    name: "Long Crowded Market",
    longOpenInterest: 60_000,
    shortOpenInterest: 20_000,
    tradeSize: 10_000,
  },
  {
    name: "Capacity Stress",
    longOpenInterest: 90_000,
    shortOpenInterest: 5_000,
    tradeSize: 10_000,
  },
];

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

function runComparison(
  initialState: MarketState,
  tradeSize: number,
  pricingModel: "original" | "bounded",
) {
  const state = { ...initialState };
  const steps = 10;
  const stepSize = tradeSize / steps;
  const prices: number[] = [];

  for (let i = 0; i < steps; i++) {
    const currentOI =
      state.longOpenInterest + state.shortOpenInterest;

    // Stop if the next step would exceed market capacity.
    if (currentOI + stepSize > config.maxCapacity) {
      return {
        averagePrice: average(prices),
        prices,
        status: "REJECTED: MARKET_CAPACITY_EXCEEDED",
      };
    }

    const price =
      pricingModel === "original"
        ? getExecutionPrice(state, config, "LONG")
        : getBoundedExecutionPrice(state, config, "LONG");

    prices.push(price);

    state.longOpenInterest += stepSize;
  }

  return {
    averagePrice: average(prices),
    prices,
    status: "COMPLETED",
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

for (const scenario of scenarios) {
  const initialState = createState(
    scenario.longOpenInterest,
    scenario.shortOpenInterest,
  );

  const original = runComparison(
    initialState,
    scenario.tradeSize,
    "original",
  );

  const bounded = runComparison(
    initialState,
    scenario.tradeSize,
    "bounded",
  );

  console.log(`\n========== ${scenario.name} ==========`);

  console.log("\nOriginal Model");
  console.log("Status:", original.status);
  console.log("Average Price:", original.averagePrice.toFixed(4));
  console.log("Price Movement:", original.prices.map(p => p.toFixed(2)));

  console.log("\nBounded Model");
  console.log("Status:", bounded.status);
  console.log("Average Price:", bounded.averagePrice.toFixed(4));
  console.log("Price Movement:", bounded.prices.map(p => p.toFixed(2)));
}