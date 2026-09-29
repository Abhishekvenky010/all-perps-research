import { describe, it } from "vitest";

import {
  getExecutionPrice,
  getConvexExecutionPrice,
} from "../src/amm/Pricing.js";


describe("Pricing curve comparison", () => {

  const config = {
    symbol: "TEST",
    maxCapacity: 100000,
    skewCoefficient: 0.2,
    capacityCoefficient: 0.05,
    maxLeverage: 10,
  };


  it("compares linear and convex pricing", () => {

    const states = [
      {
        name: "small skew",
        longOpenInterest: 10000,
        shortOpenInterest: 0,
      },
      {
        name: "medium skew",
        longOpenInterest: 50000,
        shortOpenInterest: 0,
      },
      {
        name: "large skew",
        longOpenInterest: 90000,
        shortOpenInterest: 0,
      },
    ];


    for (const item of states) {

      const state = {
        symbol: "TEST",
        indexPrice: 100,
        longOpenInterest:
          item.longOpenInterest,
        shortOpenInterest:
          item.shortOpenInterest,
          ammTwapPrice: 100,
      };


      console.log(
        item.name,
        {

          linear:
            getExecutionPrice(
              state,
              config,
              "LONG",
            ),


          convex:
            getConvexExecutionPrice(
              state,
              config,
              "LONG",
            ),

        },
      );
    }

  });

});