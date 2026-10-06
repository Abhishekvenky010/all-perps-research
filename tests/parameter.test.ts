import { describe, it } from "vitest";

import { simulateTrade } from "../src/simulation/TradeSimulator.js";
import { PositionManager } from "../src/position/PositionManager.js";

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
      const positionManager = new PositionManager();
      state.longOpenInterest = 0;
      state.shortOpenInterest = 0;
      positionManager.openPosition({
        id: "existing-long",
        trader: "existing-long",
        market: state.symbol,
        side: "LONG",
        size: 50_000,
        entryPrice: 100,
        margin: 5_000,
      }, state);
      positionManager.openPosition({
        id: "existing-short",
        trader: "existing-short",
        market: state.symbol,
        side: "SHORT",
        size: 10_000,
        entryPrice: 100,
        margin: 1_000,
      }, state);


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