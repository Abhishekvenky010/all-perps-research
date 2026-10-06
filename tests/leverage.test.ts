import { describe, it, expect } from "vitest";

import {
  calculateLeverage,
  isLeverageAllowed,
} from "../src/risk/Leverage.js";


describe("Leverage Engine", () => {


  const position = {

    id: "1",

    trader: "Alice",

    market: "BTC-PERP",

    side: "LONG" as const,

    size: 10000,

    entryPrice: 100,

    margin: 1000,

  };


  it("calculates position leverage", () => {

    const leverage =
      calculateLeverage(
        position,
      );


    expect(leverage)
      .toBe(10);

  });



  it("allows leverage below maximum limit", () => {

    const result =
      isLeverageAllowed(
        position,
        20,
      );


    expect(result)
      .toBe(true);

  });

  it("allows leverage exactly at the maximum boundary", () => {
    const boundaryPosition = {
      ...position,
      size: 20_000,
      margin: 1_000,
    };

    expect(isLeverageAllowed(boundaryPosition, 20)).toBe(true);
  });



  it("rejects leverage above maximum limit", () => {


    const highLeveragePosition = {

      ...position,

      size: 50000,

      margin: 1000,

    };


    const result =
      isLeverageAllowed(
        highLeveragePosition,
        20,
      );


    expect(result)
      .toBe(false);

  });



  it("handles 1x leverage position", () => {


    const spotLikePosition = {

      ...position,

      size: 1000,

      margin: 1000,

    };


    const leverage =
      calculateLeverage(
        spotLikePosition,
      );


    expect(leverage)
      .toBe(1);

  });

  it("rejects invalid margin inputs and invalid maximum leverage", () => {
    for (const margin of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        calculateLeverage({ ...position, margin }),
      ).toThrow("INVALID_POSITION_MARGIN");
    }

    for (const maxLeverage of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        isLeverageAllowed(position, maxLeverage),
      ).toThrow("INVALID_MAX_LEVERAGE");
    }
  });


});