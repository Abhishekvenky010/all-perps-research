import {
  getExecutionPrice,
} from "../src/amm/Pricing.js";


const coefficients = [
  0.01,
  0.05,
  0.1,
  0.2,
];


for (const coefficient of coefficients) {


  const config = {

    symbol: "BTC-PERP",

    maxCapacity: 100000,

    skewCoefficient: 0,

    capacityCoefficient: coefficient,

    maxLeverage: 10,

  };


  const state = {

    symbol: "BTC-PERP",

    indexPrice: 100,

    longOpenInterest: 80000,

    shortOpenInterest: 0,

  };


  const price =
    getExecutionPrice(
      state,
      config,
      "LONG",
    );


  console.log({

    capacityCoefficient:
      coefficient,

    executionPrice:
      price,

    impact:
      `${(((price - 100) / 100) * 100).toFixed(2)}%`

  });

}