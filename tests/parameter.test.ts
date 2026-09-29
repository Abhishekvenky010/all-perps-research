import { describe, it } from "vitest";

import { simulateTrade } from "../src/simulation/TradeSimulator.js";
import { PositionManager } from "../src/position/PositionManager.js";
const positionManager = new PositionManager();

describe("Skew coefficient analysis", () => {


  it("compares different k values", () => {


    const coefficients = [
      0.05,
      0.2,
      0.5,
      1.0,
    ];


    for (const k of coefficients) {


      const state = {
        symbol: "TEST",
        indexPrice: 100,
        longOpenInterest: 50000,
        shortOpenInterest: 10000,
        ammTwapPrice: 100,
      };


      const config = {
        symbol: "TEST",
        maxCapacity: 100000,
        skewCoefficient: k,
        capacityCoefficient: 0.05,
        maxLeverage: 10,
      };


      const result = simulateTrade(
        state,
        "LONG",
        10000,
        10,
        config,
          "Alice",
          1000,
         positionManager,
  
      );


      console.log(
        `k=${k}, avgPrice=${result.averagePrice}`
      );

    }


  });


});