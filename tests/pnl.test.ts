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


});