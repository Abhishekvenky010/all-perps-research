import { describe, it, expect } from "vitest";

import { simulateTrade } from "../src/simulation/TradeSimulator.js";
import { PositionManager } from "../src/position/PositionManager.js";
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
      ammTwapPrice: 100,
    };
    const positionManager = new PositionManager();


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
      longOpenInterest: 0,
      shortOpenInterest: 0,
      ammTwapPrice: 100,
    };
    const positionManager = new PositionManager();
    positionManager.openPosition({
      id: "existing-long",
      trader: "long-trader",
      market: "TEST",
      side: "LONG",
      size: 60_000,
      entryPrice: 100,
      margin: 10_000,
    }, state);
    positionManager.openPosition({
      id: "existing-short",
      trader: "short-trader",
      market: "TEST",
      side: "SHORT",
      size: 10_000,
      entryPrice: 100,
      margin: 5_000,
    }, state);


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