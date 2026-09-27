import { describe, it, expect } from "vitest";

import { simulateTrade } from "../src/simulation/TradeSimulator.js";
import { PositionManager } from "../src/position/PositionManager.js";
const positionManager = new PositionManager();
describe("All Perps AMM Prototype", () => {


  const config = {
    symbol: "TEST",
    maxCapacity: 100000,
    skewCoefficient: 0.2,
    capacityCoefficient: 0.05,
    maxLeverage: 10,
  };


  it("keeps balanced market near oracle price", () => {


    const state = {
      symbol: "TEST",
      indexPrice: 100,
      longOpenInterest: 0,
      shortOpenInterest: 0,
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


    expect(result.averagePrice)
      .toBeGreaterThan(100);


    expect(result.averagePrice)
      .toBeLessThan(102);

  });



  it("makes crowded side more expensive", () => {


    const state = {
      symbol: "TEST",
      indexPrice: 100,
      longOpenInterest: 60000,
      shortOpenInterest: 10000,
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


    expect(result.averagePrice)
      .toBeGreaterThan(100);

  });


});