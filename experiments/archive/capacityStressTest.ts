import {
  getExecutionPrice,
} from "../../src/amm/Pricing.js";

import {
  canIncreaseExposure,
} from "../../src/amm/Capacity.js";

import fs from "fs";


const config = {

  symbol: "BTC-PERP",

  maxCapacity: 100000,

  skewCoefficient: 0.2,

  capacityCoefficient: 0.05,

  maxLeverage: 10,

};


const state = {

  symbol: "BTC-PERP",

  indexPrice: 100,
  ammTwapPrice: 100,

  longOpenInterest: 0,

  shortOpenInterest: 0,

};


const trades = [
  10000,
  10000,
  10000,
  10000,
  10000,
  10000,
  10000,
  10000,
  10000,
  10000,
  10000,
];


const results = [];


for (const size of trades) {


  console.log("\nTrying trade:", size);


  const allowed =
    canIncreaseExposure(
      state,
      config,
      size,
    );


  if (!allowed) {

    console.log(
      "REJECTED: CAPACITY LIMIT"
    );


    results.push({

      requestedIncrease: size,

      longOI:
        state.longOpenInterest,

      status:
        "REJECTED"

    });


    break;

  }


  const price =
    getExecutionPrice(
      state,
      config,
      "LONG",
    );


  state.longOpenInterest += size;


  const data = {

    longOI:
      state.longOpenInterest,

    executionPrice:
      Number(price.toFixed(2)),

    status:
      "ACCEPTED"

  };


  results.push(data);


  console.log(data);

}


fs.writeFileSync(
  "results/capacity-stress.json",
  JSON.stringify(results, null, 2),
);