import {
  getExecutionPrice,
} from "../src/amm/Pricing.js";


const values = [
  0,
  10000,
  20000,
  50000,
  80000,
  90000,
];


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


  console.log({
    longOI,
    impact: `${impact.toFixed(2)}%`,
  });

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
      (Math.abs(
      executionPrice - state.indexPrice
   )
   /
   state.indexPrice) * 100;


  console.log({
    shortOI,
    impact: `${impact.toFixed(2)}%`,
  });

}