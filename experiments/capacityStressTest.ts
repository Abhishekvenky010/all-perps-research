import {
  getExecutionPrice,
} from "../src/amm/Pricing.js";

import {
  canIncreaseExposure,
} from "../src/amm/Capacity.js";


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

    break;

  }


  const price =
    getExecutionPrice(
      state,
      config,
      "LONG",
    );


  state.longOpenInterest += size;


  console.log({

    executionPrice:
      price,

    longOI:
      state.longOpenInterest,

  });


}