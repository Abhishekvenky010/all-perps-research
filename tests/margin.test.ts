import { describe, it, expect } from "vitest";

import {
  calculateEquity,
  calculateMarginRatio,
} from "../src/risk/Margin.js";


describe("Margin Engine", () => {


  const position = {

    id:"1",

    trader:"Alice",

    market:"BTC-PERP",

    side:"LONG" as const,

    size:10000,

    entryPrice:100,

    margin:1000,

  };


  it("calculates remaining equity", () => {


    const equity =
      calculateEquity(
        position,
        -700,
      );


    expect(equity)
      .toBe(300);

  });



  it("calculates healthy margin ratio", () => {


    const ratio =
      calculateMarginRatio(
        position,
        0,
      );


    expect(ratio)
      .toBe(0.1);

  });



  it("calculates dangerous margin ratio", () => {


    const ratio =
      calculateMarginRatio(
        position,
        -900,
      );


    expect(ratio)
      .toBe(0.01);

  });


});