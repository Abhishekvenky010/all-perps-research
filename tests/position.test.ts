import { describe, it, expect } from "vitest";

import {
  PositionManager,
} from "../src/position/PositionManager.js";


describe("Position System", () => {


  it("creates and stores a position", () => {


    const manager =
      new PositionManager();


    const position = {

      id: "position-1",

      trader: "Alice",

      market: "BTC-PERP",

      side: "LONG" as const,

      size: 10000,

      entryPrice: 105,

      margin: 1000,

    };


    manager.openPosition(position);


    const stored =
      manager.getPosition(
        "position-1",
      );


    expect(stored)
      .toBeDefined();


    expect(stored?.trader)
      .toBe("Alice");


    expect(stored?.size)
      .toBe(10000);


    expect(stored?.entryPrice)
      .toBe(105);

  });



  it("closes a position", () => {


    const manager =
      new PositionManager();


    manager.openPosition({

      id: "position-2",

      trader: "Bob",

      market: "BTC-PERP",

      side: "SHORT",

      size: 5000,

      entryPrice: 100,

      margin: 500,

    });


    const closed =
      manager.closePosition(
        "position-2",
      );


    expect(closed)
      .toBeDefined();


    expect(
      manager.getPosition(
        "position-2",
      ),
    )
    .toBeUndefined();


  });



  it("returns all positions", () => {


    const manager =
      new PositionManager();


    manager.openPosition({

      id: "position-1",

      trader: "Alice",

      market: "BTC-PERP",

      side: "LONG",

      size: 10000,

      entryPrice: 105,

      margin: 1000,

    });


    manager.openPosition({

      id: "position-2",

      trader: "Bob",

      market: "BTC-PERP",

      side: "SHORT",

      size: 5000,

      entryPrice: 110,

      margin: 500,

    });


    const positions =
      manager.getAllPositions();


    expect(positions.length)
      .toBe(2);

  });


});