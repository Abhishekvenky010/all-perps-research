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

  it("supports positive, zero, and negative equity without non-finite ratios", () => {
    expect(calculateEquity(position, 500)).toBe(1_500);
    expect(calculateEquity(position, -1_000)).toBe(0);
    expect(calculateEquity(position, -2_000)).toBe(-1_000);
    expect(calculateMarginRatio(position, -1_000)).toBe(0);
    expect(calculateMarginRatio(position, -2_000)).toBe(-0.1);
  });

  it("rejects non-finite equity and invalid position size", () => {
    expect(() => calculateEquity(position, Number.NaN))
      .toThrow("INVALID_POSITION_EQUITY");
    expect(() =>
      calculateMarginRatio({ ...position, size: Number.POSITIVE_INFINITY }, 0),
    ).toThrow("INVALID_POSITION_SIZE");
  });


});