import { describe, it, expect } from "vitest";

import {
  calculateUnrealizedPnL,
} from "../src/risk/PnL.js";


describe("PnL Engine", () => {


  it("calculates LONG profit", () => {

    const position = {

      id: "1",

      trader: "Alice",

      market: "BTC-PERP",

      side: "LONG" as const,

      size: 1000,

      entryPrice: 100,

      margin: 100,

    };


    const pnl =
      calculateUnrealizedPnL(
        position,
        110,
      );


    expect(pnl)
      .toBe(10000);

  });



  it("calculates LONG loss", () => {

    const position = {

      id: "2",

      trader: "Alice",

      market: "BTC-PERP",

      side: "LONG" as const,

      size: 1000,

      entryPrice: 100,

      margin: 100,

    };


    const pnl =
      calculateUnrealizedPnL(
        position,
        90,
      );


    expect(pnl)
      .toBe(-10000);

  });



  it("calculates SHORT profit", () => {

    const position = {

      id: "3",

      trader: "Bob",

      market: "BTC-PERP",

      side: "SHORT" as const,

      size: 1000,

      entryPrice: 100,

      margin: 100,

    };


    const pnl =
      calculateUnrealizedPnL(
        position,
        90,
      );


    expect(pnl)
      .toBe(10000);

  });



  it("calculates SHORT loss", () => {

    const position = {

      id: "4",

      trader: "Bob",

      market: "BTC-PERP",

      side: "SHORT" as const,

      size: 1000,

      entryPrice: 100,

      margin: 100,

    };


    const pnl =
      calculateUnrealizedPnL(
        position,
        110,
      );


    expect(pnl)
      .toBe(-10000);

  });

  it("calculates zero PnL at the entry price", () => {
    const position = {
      id: "zero-pnl",
      trader: "Alice",
      market: "BTC-PERP",
      side: "LONG" as const,
      size: 1_000,
      entryPrice: 100,
      margin: 100,
    };

    expect(calculateUnrealizedPnL(position, 100)).toBe(0);
  });

  it("rejects invalid price and non-finite PnL results", () => {
    const position = {
      id: "invalid-pnl",
      trader: "Alice",
      market: "BTC-PERP",
      side: "LONG" as const,
      size: 1,
      entryPrice: 100,
      margin: 1,
    };

    for (const price of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => calculateUnrealizedPnL(position, price))
        .toThrow("INVALID_MARK_PRICE");
    }

    expect(() =>
      calculateUnrealizedPnL(
        { ...position, size: Number.MAX_VALUE },
        Number.MAX_VALUE,
      ),
    ).toThrow("INVALID_PNL");
  });


});