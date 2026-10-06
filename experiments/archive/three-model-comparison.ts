import {
  getExecutionPrice,
  getBoundedExecutionPrice,
  getAverageExecutionPrice,
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

function simulate(
  initialState: MarketState,
  tradeSize: number,
  pricingFunction: typeof getExecutionPrice,
) {
  const state = { ...initialState };
  const steps = 10;
  const stepSize = tradeSize / steps;
  const prices: number[] = [];

  for (let i = 0; i < steps; i++) {
    const totalOI =
      state.longOpenInterest + state.shortOpenInterest;

    if (totalOI + stepSize > config.maxCapacity) {
      return {
        averagePrice: average(prices),
        status: "REJECTED",
        prices,
      };
    }

    const price = pricingFunction(state, config, "LONG");
    prices.push(price);

    state.longOpenInterest += stepSize;
  }

  return {
    averagePrice: average(prices),
    status: "COMPLETED",
    prices,
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;

  return values.reduce((sum, value) => sum + value, 0) /
    values.length;
}

for (const scenario of scenarios) {
  const state = createState(
    scenario.longOpenInterest,
    scenario.shortOpenInterest,
  );

  const models = [
    ["Original", getExecutionPrice],
    ["Bounded", getBoundedExecutionPrice],
    ["Average", getAverageExecutionPrice],
  ] as const;

  console.log(`\n========== ${scenario.name} ==========`);

  for (const [name, pricingFunction] of models) {
    const result = simulate(
      state,
      scenario.tradeSize,
      pricingFunction,
    );

    console.log(`\n${name} Model`);
    console.log("Status:", result.status);
    console.log("Average Price:", result.averagePrice.toFixed(4));
    console.log(
      "Price Movement:",
      result.prices.map((price) => price.toFixed(2)),
    );
  }
}