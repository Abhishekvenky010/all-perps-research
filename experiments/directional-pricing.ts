
import { getExecutionPrice } from "../src/amm/Pricing.js";
import assert from "node:assert/strict";

const config = {
  symbol: "BTC-PERP",
  maxCapacity: 100000,
  skewCoefficient: 0.2,
  capacityCoefficient: 0,
  maxLeverage: 10,
};

const scenarios = [
  {
    name: "Balanced",
    longOpenInterest: 30000,
    shortOpenInterest: 30000,
    expectedLong: 100,
    expectedShort: 100,
  },
  {
    name: "Long-heavy",
    longOpenInterest: 50000,
    shortOpenInterest: 10000,
    expectedLong: 108,
    expectedShort: 92,
  },
  {
    name: "Short-heavy",
    longOpenInterest: 10000,
    shortOpenInterest: 50000,
    expectedLong: 92,
    expectedShort: 108,
  },
];

for (const scenario of scenarios) {
  const state = {
    symbol: "BTC-PERP",
    indexPrice: 100,
    longOpenInterest: scenario.longOpenInterest,
    shortOpenInterest: scenario.shortOpenInterest,
    ammTwapPrice: 100,
  };

  const longPrice = getExecutionPrice(state, config, "LONG");
  const shortPrice = getExecutionPrice(state, config, "SHORT");

  assert.equal(
    Number(longPrice.toFixed(2)),
    scenario.expectedLong,
    `${scenario.name}: unexpected LONG price`,
  );

  assert.equal(
    Number(shortPrice.toFixed(2)),
    scenario.expectedShort,
    `${scenario.name}: unexpected SHORT price`,
  );

  console.log({
    scenario: scenario.name,
    skew: state.longOpenInterest - state.shortOpenInterest,
    longPrice: Number(longPrice.toFixed(2)),
    shortPrice: Number(shortPrice.toFixed(2)),
  });
}

console.log("\nAll directional pricing assertions passed.");