import {
  getExecutionPrice,
} from "../../src/amm/Pricing.js";


const shortValues = [
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


for (const shortOI of shortValues) {


  const state = {

    symbol: "BTC-PERP",

    indexPrice: 100,
    ammTwapPrice: 100,

    longOpenInterest: 0,

    shortOpenInterest: shortOI,

    maxCapacity: 100000,

  };


  const price =
    getExecutionPrice(
      state,
      config,
      "SHORT",
    );


  console.log({
    shortOI,
    price,
  });

}