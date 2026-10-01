
import { getExecutionPrice } from "../src/amm/Pricing.js";
import assert from "node:assert/strict";

/*
  capacityCoefficient is 0, so there is no spread and both
  sides quote the skew-adjusted fair value directly.

  Skew moves the fair value:
    a long-crowded book is worth more
    a short-crowded book is worth less
*/
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
    // No skew: fair value is the TWAP.
    expectedLong: 100,
    expectedShort: 100,
  },
  {
    name: "Long-heavy",
    longOpenInterest: 50000,
    shortOpenInterest: 10000,
    // skewRatio 0.4 -> fair value 108 for both sides.
    expectedLong: 108,
    expectedShort: 108,
  },
  {
    name: "Short-heavy",
    longOpenInterest: 10000,
    shortOpenInterest: 50000,
    // skewRatio -0.4 -> fair value 92 for both sides.
    expectedLong: 92,
    expectedShort: 92,
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

  /*
    With no capacity spread the two quotes are identical, so
    the skew is what moves the market.
  */
  assert.equal(
    Number((longPrice - shortPrice).toFixed(10)),
    0,
    `${scenario.name}: quotes should match without a capacity spread`,
  );

  console.log({
    scenario: scenario.name,
    skew: state.longOpenInterest - state.shortOpenInterest,
    fairValue: Number(longPrice.toFixed(2)),
  });
}

console.log("\nAll directional pricing assertions passed.");