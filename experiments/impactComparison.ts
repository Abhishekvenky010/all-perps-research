import {
  getExecutionPrice,
} from "../src/amm/Pricing.js";

import fs from "fs";


const values = [
  0,
  10000,
  20000,
  50000,
  80000,
  90000,
];


const results: { long: { exposure: number; impact: number }[]; short: { exposure: number; impact: number }[] } = {
  long: [],
  short: [],
};


const config = {
  symbol: "BTC-PERP",
  maxCapacity: 100000,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 10,
};


console.log("LONG IMPACT");


for (const longOI of values) {

  const state = {

    symbol: "BTC-PERP",

    indexPrice: 100,

    longOpenInterest: longOI,

    shortOpenInterest: 0,

    maxCapacity: 100000,

  };


  const executionPrice =
    getExecutionPrice(
      state,
      config,
      "LONG",
    );


  const impact =
    ((executionPrice - state.indexPrice)
      / state.indexPrice) * 100;


  const data = {
    exposure: longOI,
    impact: Number(impact.toFixed(2)),
  };


  results.long.push(data);


  console.log(data);

}



console.log("\nSHORT IMPACT");


for (const shortOI of values) {

  const state = {

    symbol: "BTC-PERP",

    indexPrice: 100,

    longOpenInterest: 0,

    shortOpenInterest: shortOI,

    maxCapacity: 100000,

  };


  const executionPrice =
    getExecutionPrice(
      state,
      config,
      "SHORT",
    );


  const impact =
    (
      Math.abs(
        executionPrice - state.indexPrice
      )
      /
      state.indexPrice
    ) * 100;


  const data = {
    exposure: shortOI,
    impact: Number(impact.toFixed(2)),
  };


  results.short.push(data);


  console.log(data);

}



fs.writeFileSync(
  "results/skew-impact.json",
  JSON.stringify(results, null, 2),
);