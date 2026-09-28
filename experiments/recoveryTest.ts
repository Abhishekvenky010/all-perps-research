
import {
  getExecutionPrice,
} from "../src/amm/Pricing.js";

import fs from "fs";

const config = {
  symbol: "BTC-PERP",
  maxCapacity: 100000,
  skewCoefficient: 0.2,
  capacityCoefficient: 0,
  maxLeverage: 10,
};

const state = {
  symbol: "BTC-PERP",
  indexPrice: 100,
  longOpenInterest: 50000,
  shortOpenInterest: 0,
};

const shortTrades = [
  10000,
  10000,
  10000,
];

const results = [];

results.push({
  shortOI: state.shortOpenInterest,
  longOI: state.longOpenInterest,
  executionPrice: 100,
  skew: state.longOpenInterest - state.shortOpenInterest,
});

console.log("INITIAL STATE");
console.log(results[0]);

for (const size of shortTrades) {
  // Capture the market state before the trade.
  const skewBefore =
    state.longOpenInterest -
    state.shortOpenInterest;

  const price = getExecutionPrice(
    state,
    config,
    "SHORT",
  );

  // Apply the trade.
  state.shortOpenInterest += size;

  // Capture the market state after the trade.
  const skewAfter =
    state.longOpenInterest -
    state.shortOpenInterest;

  const data = {
    shortAdded: size,
    longOI: state.longOpenInterest,
    shortOI: state.shortOpenInterest,
    executionPrice: Number(price.toFixed(2)),
    skewBefore,
    skewAfter,
  };

  results.push(data);

  console.log(data);
}

fs.writeFileSync(
  "results/recovery.json",
  JSON.stringify(results, null, 2),
);

console.log("Recovery results saved.");