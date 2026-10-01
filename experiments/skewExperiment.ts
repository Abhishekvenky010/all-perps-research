import {
  getExecutionPrice,
} from "../src/amm/Pricing.js";


const longValues = [
  0,
  10000,
  20000,
  50000,
  80000,
  90000,
];


for (const longOI of longValues) {


  const state = {

    symbol: "BTC-PERP",

    indexPrice: 100,
    ammTwapPrice: 100,

    longOpenInterest: longOI,

    shortOpenInterest: 0,

    maxCapacity: 100000,

  };


  const price =
    getExecutionPrice(
      state,
      {
        symbol: "BTC-PERP",
        maxCapacity: 100000,
        skewCoefficient: 0.2,
        capacityCoefficient: 0.05,
        maxLeverage: 10,
      },
      "LONG",
    );


  console.log({
    longOI,
    price,
  });

}