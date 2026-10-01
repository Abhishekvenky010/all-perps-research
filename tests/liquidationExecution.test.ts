import { describe, it, expect } from "vitest";

import {
  liquidatePosition,
} from "../src/risk/LiquidationEngine.js";

import {
  PositionManager,
} from "../src/position/PositionManager.js";


describe("Liquidation Execution", () => {


  it("does not liquidate healthy position", () => {


    const manager =
      new PositionManager();


    const market = {

      symbol: "BTC-PERP",

      indexPrice: 110,
      ammTwapPrice: 110,

      longOpenInterest: 10000,

      shortOpenInterest: 0,

    };


    const position = {

      id: "pos-1",

      trader: "Alice",

      market: "BTC-PERP",

      side: "LONG" as const,

      size: 100,

      entryPrice: 100,

      margin: 1000,

    };


    manager.openPosition(position);



    expect(() =>
      liquidatePosition(
        position,
        110,
        market,
        manager,
        0.05,
      )
    ).toThrow(
      "POSITION_HEALTHY",
    );


    expect(
      manager.getPosition("pos-1")
    ).toBeDefined();


  });



  it("liquidates unhealthy position", () => {


    const manager =
      new PositionManager();


    const market = {

      symbol: "BTC-PERP",

      indexPrice: 80,
      ammTwapPrice: 80,

      longOpenInterest: 10000,

      shortOpenInterest: 0,

    };


    const position = {

      id: "pos-2",

      trader: "Bob",

      market: "BTC-PERP",

      side: "LONG" as const,

      size: 100,

      entryPrice: 100,

      margin: 100,

    };


    manager.openPosition(position);



    const result =
      liquidatePosition(
        position,
        80,
        market,
        manager,
        0.05,
      );


    expect(
      result.closed
    ).toBe(true);



    expect(
      manager.getPosition("pos-2")
    ).toBeUndefined();


  });



  it("updates market exposure after liquidation", () => {


    const manager =
      new PositionManager();


    const market = {

      symbol: "BTC-PERP",

      indexPrice: 80,
      ammTwapPrice: 80,

      longOpenInterest: 50000,

      shortOpenInterest: 0,

    };


    const position = {

      id: "pos-3",

      trader: "Charlie",

      market: "BTC-PERP",

      side: "LONG" as const,

      size: 10000,

      entryPrice: 100,

      margin: 100,

    };


    manager.openPosition(position);



    liquidatePosition(
      position,
      80,
      market,
      manager,
      0.05,
    );


    expect(
      market.longOpenInterest
    ).toBe(40000);


  });


});