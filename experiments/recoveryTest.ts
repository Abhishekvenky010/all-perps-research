import {
  getExecutionPrice,
} from "../src/amm/Pricing.js";


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
  10000
];


console.log("INITIAL STATE");

console.log({

  longOI:
    state.longOpenInterest,

  shortOI:
    state.shortOpenInterest,

});


for (const size of shortTrades) {


  const price =
    getExecutionPrice(
      state,
      config,
      "SHORT",
    );


  state.shortOpenInterest += size;


  console.log({

    shortAdded:
      size,

    executionPrice:
      price,

    longOI:
      state.longOpenInterest,

    shortOI:
      state.shortOpenInterest,

  });


}